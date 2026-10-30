// Entry-point pins for the payment-signing path and the wallet/client policy
// edges that no existing test exercised:
//   - signChallenge must prefer typed-data signing when the signer offers it,
//     and an injected wallet's authorization must ecrecover to the payer over
//     the EIP-712 digest the token contract verifies (not an EIP-191 hash);
//   - a locked CitrateWallet refuses typed-data signing;
//   - X402Client refuses a negative lifetime budget and hands out ledger copies;
//   - createWallet enforces its passphrase floor.
//
// Keys here are generated per run (viem generatePrivateKey); nothing touches a
// network or a real wallet.

import { afterEach, describe, expect, test } from 'vitest';
import { recoverAddress, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

import {
  eip712Digest,
  signChallenge,
  transferWithAuthorizationStructHash,
  wsaltDomainSeparator,
  X402Client,
  type Eip712TypedData,
  type PaymentChallenge,
  type Signer,
} from '../src/x402.js';
import { InjectedSigner } from '../src/wallet/injected.js';
import { CitrateWallet, clearKeystore, createWallet } from '../src/wallet/citrate.js';

const CHAIN = 40204;
const TOKEN = ('0x' + '22'.repeat(20)) as Address;
const PAYEE = ('0x' + '33'.repeat(20)) as Address;

function challenge(): PaymentChallenge {
  const now = Math.floor(Date.now() / 1000);
  return {
    version: 1,
    facilitator: ('0x' + '44'.repeat(20)) as Address,
    token: TOKEN,
    chain_id: CHAIN,
    recipient: PAYEE,
    amount: '1000',
    valid_after: 0,
    valid_before: now + 120,
    nonce: ('0x' + '5a'.repeat(32)) as Hex,
    digest: ('0x' + '00'.repeat(32)) as Hex,
  } as PaymentChallenge;
}

function digestFor(c: PaymentChallenge, from: Address): Hex {
  return eip712Digest({
    domainSeparator: wsaltDomainSeparator(c.chain_id, c.token),
    structHash: transferWithAuthorizationStructHash({
      from,
      to: c.recipient,
      value: BigInt(c.amount),
      validAfter: BigInt(c.valid_after),
      validBefore: BigInt(c.valid_before),
      nonce: c.nonce,
    }),
  });
}

/// A browser-wallet stand-in backed by a throwaway local key. It implements
/// the two RPC methods with their real semantics: personal_sign signs the
/// EIP-191-prefixed hash, eth_signTypedData_v4 signs the EIP-712 digest.
function fakeWalletProvider(pk: Hex) {
  const account = privateKeyToAccount(pk);
  const calls: string[] = [];
  const provider = {
    async request(args: { method: string; params?: unknown[] }): Promise<unknown> {
      calls.push(args.method);
      switch (args.method) {
        case 'eth_requestAccounts':
          return [account.address];
        case 'eth_chainId':
          return '0x' + CHAIN.toString(16);
        case 'personal_sign': {
          const [hash] = args.params as [Hex];
          return account.signMessage({ message: { raw: hash } });
        }
        case 'eth_signTypedData_v4': {
          const td = JSON.parse((args.params as [string, string])[1]) as Eip712TypedData;
          const { EIP712Domain: _d, ...types } = td.types;
          const m = td.message;
          return account.signTypedData({
            domain: td.domain,
            types,
            primaryType: td.primaryType,
            message: {
              from: m.from,
              to: m.to,
              value: BigInt(m.value),
              validAfter: BigInt(m.validAfter),
              validBefore: BigInt(m.validBefore),
              nonce: m.nonce,
            },
          } as never);
        }
        default:
          throw new Error(`unexpected method ${args.method}`);
      }
    },
  };
  return { provider, calls, address: account.address };
}

function sigHex(p: { r: Hex; s: Hex; v: number }): Hex {
  return (p.r + p.s.slice(2) + p.v.toString(16).padStart(2, '0')) as Hex;
}

describe('signChallenge signer routing', () => {
  test('a signer offering typed-data signing is never asked for a raw-digest signature', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    let rawCalls = 0;
    let typedCalls = 0;
    const signer: Signer = {
      address: account.address,
      async sign(args) {
        rawCalls++;
        return account.sign({ hash: args.hash });
      },
      async signEip712(td) {
        typedCalls++;
        const { EIP712Domain: _d, ...types } = td.types;
        const m = td.message;
        return account.signTypedData({
          domain: td.domain,
          types,
          primaryType: td.primaryType,
          message: { ...m, value: BigInt(m.value), validAfter: BigInt(m.validAfter), validBefore: BigInt(m.validBefore) },
        } as never);
      },
    };
    await signChallenge(challenge(), signer);
    expect(typedCalls).toBe(1);
    expect(rawCalls).toBe(0);
  });

  test('an injected-wallet authorization ecrecovers to the payer over the EIP-712 digest', async () => {
    const w = fakeWalletProvider(generatePrivateKey());
    const signer = await InjectedSigner.connect({ provider: w.provider, chainId: CHAIN });
    const c = challenge();
    const payload = await signChallenge(c, signer);
    const recovered = await recoverAddress({ hash: digestFor(c, signer.address), signature: sigHex(payload) });
    expect(recovered.toLowerCase()).toBe(w.address.toLowerCase());
    expect(w.calls).toContain('eth_signTypedData_v4');
    expect(w.calls).not.toContain('personal_sign');
  });

  test('control: the same digest signed through personal_sign does NOT recover the payer', async () => {
    const pk = generatePrivateKey();
    const w = fakeWalletProvider(pk);
    const c = challenge();
    const digest = digestFor(c, w.address);
    const prefixed = (await w.provider.request({ method: 'personal_sign', params: [digest, w.address] })) as Hex;
    const recovered = await recoverAddress({ hash: digest, signature: prefixed });
    expect(recovered.toLowerCase()).not.toBe(w.address.toLowerCase());
  });
});

describe('CitrateWallet typed-data signing when locked', () => {
  test('signEip712 on a locked wallet rejects instead of signing', async () => {
    const key = new Uint8Array(32).map((_, i) => (i * 13 + 1) & 0xff);
    const wallet = new CitrateWallet(key);
    // Unlocked: works.
    const c = challenge();
    await expect(signChallenge(c, wallet)).resolves.toBeDefined();
    wallet.lock();
    await expect(signChallenge(c, wallet)).rejects.toThrow(/locked/);
  });
});

describe('X402Client policy edges', () => {
  const base = () => ({
    signer: privateKeyToAccount(generatePrivateKey()) as unknown as Signer,
    chainId: CHAIN,
    allowedTokens: [TOKEN],
    allowedRecipients: [PAYEE],
    maxPayWei: 10_000n,
    maxTotalWei: 10_000n,
  });

  test('a negative lifetime budget refuses construction', () => {
    expect(() => new X402Client({ ...base(), maxTotalWei: -1n })).toThrow(/maxTotalWei/);
  });

  test('the payments ledger is handed out as copies the caller cannot rewrite', async () => {
    const c = challenge();
    const fetchImpl = (async (_i: unknown, init?: RequestInit) => {
      const paid = new Headers(init?.headers).get('x-payment');
      if (paid) return new Response('{}', { status: 500 });
      return new Response(JSON.stringify({ x402: c }), { status: 402 });
    }) as unknown as typeof fetch;
    const client = new X402Client({ ...base(), fetch: fetchImpl });
    await client.send('https://gw.example/v1/chat');
    const snap = client.payments;
    expect(snap).toHaveLength(1);
    expect(snap[0].served).toBe(false);
    snap[0].served = true;
    snap.pop();
    expect(client.payments).toHaveLength(1);
    expect(client.payments[0].served).toBe(false);
  });
});

describe('createWallet passphrase floor', () => {
  afterEach(() => clearKeystore());

  test('an 11-character passphrase is refused before any key is generated', async () => {
    await expect(createWallet('elevenchars')).rejects.toThrow(/at least 12/);
  });

  test('control: a 12-character passphrase is accepted', async () => {
    const w = await createWallet('twelve-chars');
    expect(w.unlocked).toBe(true);
  });
});
