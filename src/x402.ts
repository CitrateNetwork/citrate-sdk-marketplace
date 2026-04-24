// TypeScript port of the Rust X402Client (CM-02).
//
// Mirrors:
//   crates/x402-axum/src/digest.rs    (EIP-712 digest math)
//   crates/x402-axum/src/types.rs     (PaymentChallenge + PaymentPayload)
//   crates/x402-axum/src/header.rs    (X-PAYMENT URL-safe base64 codec)
//   crates/x402-axum/src/client.rs    (auto-pay-on-402 loop)
//
// Anything that crosses the wire MUST byte-match the Rust impl. The
// hashing constants below are mechanically equivalent to the Solidity
// constants in `contracts/src/WrappedSALT.sol`.
//
// Wallet abstraction: this module accepts a `Signer` interface, NOT a
// raw private key. WP-04.3 slice 1 wires a sessionStorage-backed test
// signer (dev-only). WP-04.3 slice 2 swaps in a wagmi/walletconnect
// signer behind the same interface.

import {
  bytesToHex,
  concat,
  encodeAbiParameters,
  encodePacked,
  hexToBytes,
  keccak256,
  numberToHex,
  pad,
  type Address,
  type Hex,
} from 'viem';

// ── Constants — must match WrappedSALT.sol ──────────────────────

const DOMAIN_NAME = 'Wrapped SALT';
const DOMAIN_VERSION = '1';
const EIP712_DOMAIN_TYPE =
  'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)';
const TRANSFER_WITH_AUTHORIZATION_TYPE =
  'TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)';

/// Wire size of a serialized PaymentPayload. Mirrors `PAYLOAD_BYTES`
/// in `crates/x402-axum/src/types.rs`.
export const PAYLOAD_BYTES = 20 + 20 + 32 + 32 + 32 + 32 + 1 + 32 + 32; // 233

// ── Wire types ──────────────────────────────────────────────────

/// JSON body the server returns under `{ "x402": ... }` on 402.
export interface PaymentChallenge {
  version: number;
  facilitator: Address;
  token: Address;
  chain_id: number;
  /// Decimal string — JSON numbers lose precision above 2^53.
  amount: string;
  /// 32-byte hex (`0x` + 64 chars).
  nonce: Hex;
  valid_after: number;
  valid_before: number;
  recipient: Address;
  /// Server's preview digest (computed with `from = address(0)` since
  /// the server doesn't know the payer at challenge time). Useful for
  /// debugging UIs; the client must NOT match against it strictly.
  digest: Hex;
}

/// Signed authorization the client sends back via the `X-PAYMENT`
/// header.
export interface PaymentPayload {
  from: Address;
  to: Address;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
  v: number;
  r: Hex;
  s: Hex;
}

// ── EIP-712 digest math ─────────────────────────────────────────

/// `keccak256(EIP712Domain type) ⊕ keccak(name) ⊕ keccak(version) ⊕
///  chainId ⊕ verifyingContract`
export function wsaltDomainSeparator(
  chainId: number,
  verifyingContract: Address,
): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'uint256' },
        { type: 'address' },
      ],
      [
        keccak256(encodePacked(['string'], [EIP712_DOMAIN_TYPE])),
        keccak256(encodePacked(['string'], [DOMAIN_NAME])),
        keccak256(encodePacked(['string'], [DOMAIN_VERSION])),
        BigInt(chainId),
        verifyingContract,
      ],
    ),
  );
}

/// EIP-712 struct hash for a `TransferWithAuthorization`.
/// Mirrors `WrappedSALT.sol:135-138`.
export function transferWithAuthorizationStructHash(args: {
  from: Address;
  to: Address;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
}): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'address' },
        { type: 'address' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'bytes32' },
      ],
      [
        keccak256(encodePacked(['string'], [TRANSFER_WITH_AUTHORIZATION_TYPE])),
        args.from,
        args.to,
        args.value,
        args.validAfter,
        args.validBefore,
        args.nonce,
      ],
    ),
  );
}

/// Final EIP-712 digest the client must sign.
/// `keccak256(0x19 0x01 ‖ domainSep ‖ structHash)`.
export function eip712Digest(args: {
  domainSeparator: Hex;
  structHash: Hex;
}): Hex {
  return keccak256(
    concat(['0x1901', args.domainSeparator, args.structHash]),
  );
}

// ── Wire encoding (PaymentPayload ↔ bytes) ──────────────────────

/// Serialize a PaymentPayload to its 233-byte on-the-wire form.
/// Layout matches `PaymentPayload::to_bytes` in `crates/x402-axum/src/types.rs`.
export function paymentToBytes(p: PaymentPayload): Uint8Array {
  const out = new Uint8Array(PAYLOAD_BYTES);
  let off = 0;
  // from(20)
  out.set(hexToBytes(p.from), off); off += 20;
  // to(20)
  out.set(hexToBytes(p.to), off); off += 20;
  // value(32) — big-endian
  out.set(hexToBytes(pad(numberToHex(p.value, { size: 32 }), { size: 32 })), off); off += 32;
  // validAfter(32)
  out.set(hexToBytes(pad(numberToHex(p.validAfter, { size: 32 }), { size: 32 })), off); off += 32;
  // validBefore(32)
  out.set(hexToBytes(pad(numberToHex(p.validBefore, { size: 32 }), { size: 32 })), off); off += 32;
  // nonce(32)
  out.set(hexToBytes(p.nonce), off); off += 32;
  // v(1)
  out[off] = p.v; off += 1;
  // r(32)
  out.set(hexToBytes(p.r), off); off += 32;
  // s(32)
  out.set(hexToBytes(p.s), off); off += 32;
  if (off !== PAYLOAD_BYTES) {
    throw new Error(`paymentToBytes: wrote ${off} bytes, expected ${PAYLOAD_BYTES}`);
  }
  return out;
}

/// Inverse of paymentToBytes — parse a 233-byte wire payload.
export function bytesToPayment(bytes: Uint8Array): PaymentPayload {
  if (bytes.length !== PAYLOAD_BYTES) {
    throw new Error(`bytesToPayment: got ${bytes.length} bytes, expected ${PAYLOAD_BYTES}`);
  }
  let off = 0;
  const slice = (n: number) => {
    const out = bytes.slice(off, off + n);
    off += n;
    return out;
  };
  return {
    from: bytesToHex(slice(20)) as Address,
    to: bytesToHex(slice(20)) as Address,
    value: BigInt(bytesToHex(slice(32))),
    validAfter: BigInt(bytesToHex(slice(32))),
    validBefore: BigInt(bytesToHex(slice(32))),
    nonce: bytesToHex(slice(32)),
    v: bytes[off++],
    r: bytesToHex(slice(32)),
    s: bytesToHex(slice(32)),
  };
}

// ── X-PAYMENT header codec ──────────────────────────────────────

/// URL-safe base64 (no padding) — same convention the Rust crate uses.
export function encodePaymentHeader(payload: PaymentPayload): string {
  return base64UrlNoPad(paymentToBytes(payload));
}

export function decodePaymentHeader(value: string): PaymentPayload {
  const bytes = base64UrlDecode(value.trim());
  return bytesToPayment(bytes);
}

function base64UrlNoPad(bytes: Uint8Array): string {
  // Build a binary string without any browser-Buffer dependency.
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const std = btoa(bin);
  return std.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const padding = (4 - (padded.length % 4)) % 4;
  const bin = atob(padded + '='.repeat(padding));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── Signer abstraction + signChallenge ──────────────────────────

/// Slim signer interface so the SDK doesn't depend on viem's full
/// WalletClient. Accept anything that can produce an EVM address and
/// sign a 32-byte digest. Both `privateKeyToAccount` (dev) and a
/// wagmi WalletClient (slice 2) satisfy this.
export interface Signer {
  /// 0x-prefixed checksummed (or lowercase) address.
  readonly address: Address;
  /// Produce an EVM-canonical (v ∈ {27, 28}) ECDSA signature over the
  /// 32-byte hash. viem's account.sign({ hash }) matches.
  sign(args: { hash: Hex }): Promise<{ r: Hex; s: Hex; v: bigint } | Hex>;
}

/// Extension capability for signers that can send raw transactions
/// (W-01 slice 2). Optional — not every Signer exposes it; callers
/// that need tx-send should check `'sendTransaction' in signer`
/// before using. Both CitrateWallet and InjectedSigner implement
/// this; the dev-key path does via viem's account.sign + a
/// WalletClient.
export interface TxSigner extends Signer {
  /// Send a transaction. Returns the tx hash once accepted by the
  /// caller's wallet adapter (NOT necessarily confirmed on-chain —
  /// caller polls `eth_getTransactionReceipt` separately).
  sendTransaction(tx: {
    to: Address;
    data?: Hex;
    value?: bigint;
  }): Promise<Hex>;
}

/// Narrow runtime guard for callers to detect whether a Signer is
/// also a TxSigner.
export function isTxSigner(s: Signer): s is TxSigner {
  return typeof (s as { sendTransaction?: unknown }).sendTransaction === 'function';
}

/// Build a signed PaymentPayload from the server's PaymentChallenge.
///
/// The advertised `challenge.digest` is a *preview* (server didn't
/// know the payer at challenge time). The client recomputes the
/// digest with its own `from = signer.address` and signs that. The
/// on-chain wSALT verifies against the recomputed digest, so this is
/// the correct digest regardless of what the server advertised.
export async function signChallenge(
  challenge: PaymentChallenge,
  signer: Signer,
): Promise<PaymentPayload> {
  const value = BigInt(challenge.amount);
  const validAfter = BigInt(challenge.valid_after);
  const validBefore = BigInt(challenge.valid_before);

  const domain = wsaltDomainSeparator(challenge.chain_id, challenge.token);
  const structHash = transferWithAuthorizationStructHash({
    from: signer.address,
    to: challenge.recipient,
    value,
    validAfter,
    validBefore,
    nonce: challenge.nonce,
  });
  const digest = eip712Digest({ domainSeparator: domain, structHash });

  const sig = await signer.sign({ hash: digest });
  let r: Hex;
  let s: Hex;
  let v: number;
  if (typeof sig === 'string') {
    // viem's signMessage path returns 65-byte hex `0xrrr…sss…vv`.
    if (sig.length !== 132) {
      throw new Error(`signer returned ${sig.length}-char hex; expected 132`);
    }
    r = ('0x' + sig.slice(2, 66)) as Hex;
    s = ('0x' + sig.slice(66, 130)) as Hex;
    v = parseInt(sig.slice(130, 132), 16);
  } else {
    r = sig.r;
    s = sig.s;
    v = Number(sig.v);
  }
  if (v !== 27 && v !== 28) {
    throw new Error(`signature v=${v} not in {27,28}; signer returned non-EVM-canonical sig`);
  }

  return {
    from: signer.address,
    to: challenge.recipient,
    value,
    validAfter,
    validBefore,
    nonce: challenge.nonce,
    v,
    r,
    s,
  };
}

// ── Auto-pay client ─────────────────────────────────────────────

export interface X402ClientOptions {
  signer: Signer;
  /// Optional: cap how much the client is willing to pay in a single
  /// retry. Mirrors the Rust client's `budget_wei`. If the server's
  /// challenged amount exceeds this, the retry is skipped and the
  /// 402 is returned to the caller.
  maxPayWei?: bigint;
  /// Optional: drop in a custom fetch (for tests). Defaults to global.
  fetch?: typeof fetch;
}

/// Auto-pay-on-402 client.
///
/// Usage:
/// ```ts
/// const client = new X402Client({ signer });
/// const resp = await client.send('http://gateway/v1/chat/completions', {
///   method: 'POST',
///   body: JSON.stringify({ model: 'llama-3.1-8b', messages: [...] }),
/// });
/// ```
export class X402Client {
  private readonly opts: X402ClientOptions;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: X402ClientOptions) {
    this.opts = opts;
    this.fetchImpl = opts.fetch ?? fetch;
  }

  /// Send a request; if it returns 402 with a parseable challenge,
  /// sign and retry once. Anything other than 402 (200, 4xx, 5xx,
  /// network error) is returned to the caller as-is.
  async send(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const first = await this.fetchImpl(input, init);
    if (first.status !== 402) return first;

    let body: unknown;
    try {
      body = await first.clone().json();
    } catch {
      return first;
    }
    const challenge = extractChallenge(body);
    if (!challenge) return first;

    if (this.opts.maxPayWei !== undefined) {
      const ask = BigInt(challenge.amount);
      if (ask > this.opts.maxPayWei) {
        return first;
      }
    }

    const payload = await signChallenge(challenge, this.opts.signer);
    const headerVal = encodePaymentHeader(payload);

    const headers = new Headers(init?.headers);
    headers.set('x-payment', headerVal);
    return this.fetchImpl(input, { ...init, headers });
  }
}

function extractChallenge(body: unknown): PaymentChallenge | null {
  if (!body || typeof body !== 'object') return null;
  const x402 = (body as { x402?: unknown }).x402;
  if (!x402 || typeof x402 !== 'object') return null;
  const c = x402 as Record<string, unknown>;
  // Light validation. Trust the server's shape; anything missing
  // means we can't sign and we return the original 402.
  for (const k of [
    'version',
    'facilitator',
    'token',
    'chain_id',
    'amount',
    'nonce',
    'valid_after',
    'valid_before',
    'recipient',
    'digest',
  ]) {
    if (!(k in c)) return null;
  }
  return c as unknown as PaymentChallenge;
}
