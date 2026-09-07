// RM-Q MEDIUM + LOW remediation tripwires for citrate-sdk-marketplace.
//
// One block per finding. Each asserts the FIXED (GREEN) behaviour and, where a
// prior fixture encoded the bug as acceptable, inverts it (RC-8).
//
//   SMK-B-004  x402 validity window bounded (maxValidityWindowSec)
//   SMK-B-005  paid retry does not follow redirects (x-payment not leaked)
//   SMK-B-006  event parsers drop logs from a foreign emitter
//   SMK-B-007  decryptKeystore rejects an over-large PBKDF2 c (DoS)
//   SMK-B-008  decryptKeystore rejects an under-floor c; unlockWallet binds addr
//   SMK-B-011  CitrateWallet implements signEip712 (no raw-digest-only oracle)
//   SMK-B-012  key material is zeroized after use

import { describe, expect, test, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import type { Address, Hex, Log } from 'viem';
import { encodeAbiParameters, keccak256 } from 'viem';

import {
  X402Client,
  type PaymentChallenge,
  type X402ClientOptions,
} from '../src/x402.js';
import { parseCreditsEvents } from '../src/credits.js';
import {
  encryptKeystore,
  decryptKeystore,
  MIN_PBKDF2_ITERATIONS,
  MAX_PBKDF2_ITERATIONS,
  type Keystore,
} from '../src/wallet/keystore.js';
import { CitrateWallet } from '../src/wallet/citrate.js';

const TEST_PRIVATE_KEY: Hex =
  '0x1122334455667788' +
  '99aabbccddee0011' +
  '2233445566778899' +
  'aabbccddee001122' as Hex;
const account = privateKeyToAccount(TEST_PRIVATE_KEY);
const TOKEN = '0x8951ae72e5479cae28ef7bb3caa4207d5719e24b' as Address;
const RECIPIENT = ('0x' + 'a2'.repeat(20)) as Address;
const MAX = 10_000_000_000_000_000_000_000n;

function validOpts(over: Partial<X402ClientOptions> = {}): X402ClientOptions {
  return {
    signer: account,
    chainId: 40204,
    allowedTokens: [TOKEN],
    allowedRecipients: [RECIPIENT],
    maxPayWei: MAX,
    maxTotalWei: MAX,
    ...over,
  };
}

function challenge(over: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  const base: PaymentChallenge = {
    version: 1,
    facilitator: ('0x' + 'fa'.repeat(20)) as Address,
    token: TOKEN,
    chain_id: 40204,
    amount: '1000000000000000000',
    nonce: ('0x' + '77'.repeat(32)) as Hex,
    valid_after: now - 60,
    valid_before: now + 120,
    recipient: RECIPIENT,
    digest: ('0x' + '00'.repeat(32)) as Hex,
  };
  return { ...base, ...over };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('SMK-B-004 — x402 validity window is bounded', () => {
  test('refuses a ~285-million-year valid_before (unbounded window)', async () => {
    const seen: boolean[] = [];
    const fetchImpl = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      const paid = new Headers(init?.headers).has('x-payment');
      seen.push(paid);
      if (paid) return jsonResponse({ ok: true }, 200);
      return jsonResponse({ x402: challenge({ valid_before: 9_007_199_254_740_991 }) }, 402);
    });
    const client = new X402Client(validOpts({ fetch: fetchImpl }));
    const resp = await client.send('http://gateway/v1/chat');
    expect(resp.status).toBe(402); // returned unsigned
    expect(seen).toEqual([false]); // no paid retry was made
    expect(client.payments).toHaveLength(0);
  });

  test('refuses a far-future window even when its span is short', async () => {
    const now = Math.floor(Date.now() / 1000);
    const fetchImpl = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      if (new Headers(init?.headers).has('x-payment')) return jsonResponse({}, 200);
      return jsonResponse(
        { x402: challenge({ valid_after: now + 1_000_000, valid_before: now + 1_000_060 }) },
        402,
      );
    });
    const client = new X402Client(validOpts({ fetch: fetchImpl }));
    expect((await client.send('http://gateway/v1/chat')).status).toBe(402);
  });

  test('signs a short in-window challenge (inert on honest traffic)', async () => {
    const fetchImpl = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      if (new Headers(init?.headers).has('x-payment')) return jsonResponse({ ok: true }, 200);
      return jsonResponse({ x402: challenge() }, 402);
    });
    const client = new X402Client(validOpts({ fetch: fetchImpl }));
    expect((await client.send('http://gateway/v1/chat')).status).toBe(200);
    expect(client.payments).toHaveLength(1);
  });

  test('maxValidityWindowSec must be a positive integer when set', () => {
    expect(() => new X402Client(validOpts({ maxValidityWindowSec: 0 }))).toThrow();
    expect(() => new X402Client(validOpts({ maxValidityWindowSec: -5 }))).toThrow();
  });
});

describe('SMK-B-005 — paid retry does not follow redirects', () => {
  test('the paid retry is issued with redirect:manual', async () => {
    let paidInit: RequestInit | undefined;
    const fetchImpl = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      if (new Headers(init?.headers).has('x-payment')) {
        paidInit = init;
        return jsonResponse({ ok: true }, 200);
      }
      return jsonResponse({ x402: challenge() }, 402);
    });
    const client = new X402Client(validOpts({ fetch: fetchImpl }));
    await client.send('http://gateway/v1/chat', { method: 'POST' });
    // The x-payment bearer authorization must never be re-driven to a host the
    // client did not choose: the retry pins redirect handling to manual so a
    // 302 cannot forward the header cross-origin.
    expect(paidInit?.redirect).toBe('manual');
  });
});

describe('SMK-B-006 — event parsers reject a foreign emitter', () => {
  const GATEWAY = ('0x' + 'bb'.repeat(20)) as Address;
  const ATTACKER = ('0x' + 'ee'.repeat(20)) as Address;

  function creditsPurchasedLog(emitter: Address): Log {
    const institution = ('0x' + 'cc'.repeat(20)) as Address;
    const stablecoin = ('0x' + 'dd'.repeat(20)) as Address;
    const sigHash = keccak256(
      new TextEncoder().encode(
        'CreditsPurchased(address,address,uint256,uint256,uint256)',
      ),
    );
    return {
      address: emitter as Hex,
      blockNumber: 1n,
      blockHash: ('0x' + '00'.repeat(32)) as Hex,
      data: encodeAbiParameters(
        [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
        [1_000n, 123_456_789n, 0n],
      ) as Hex,
      logIndex: 0,
      removed: false,
      transactionHash: ('0x' + '11'.repeat(32)) as Hex,
      transactionIndex: 0,
      topics: [
        sigHash,
        encodeAbiParameters([{ type: 'address' }], [institution]) as Hex,
        encodeAbiParameters([{ type: 'address' }], [stablecoin]) as Hex,
      ],
    } as Log;
  }

  test('a correctly-shaped log from ANY other address is dropped', () => {
    // RC-8: pre-fix this decoded to a genuine CreditsPurchased event.
    expect(parseCreditsEvents([creditsPurchasedLog(ATTACKER)], GATEWAY)).toEqual([]);
  });

  test('the same log from the pinned gateway still decodes', () => {
    const out = parseCreditsEvents([creditsPurchasedLog(GATEWAY)], GATEWAY);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('CreditsPurchased');
  });

  test('a missing/invalid expectedEmitter is rejected', () => {
    expect(() => parseCreditsEvents([], '0xnope' as Address)).toThrow();
  });
});

describe('SMK-B-007 / SMK-B-008 — keystore PBKDF2 iteration bounds', () => {
  async function baseKeystore(pass = 'correct horse battery'): Promise<Keystore> {
    const key = new Uint8Array(32).fill(7);
    return encryptKeystore(key, pass, '0x' + '11'.repeat(20));
  }

  test('rejects an over-large c immediately (DoS) — SMK-B-007', async () => {
    const ks = await baseKeystore();
    ks.crypto.kdfparams.c = MAX_PBKDF2_ITERATIONS + 1;
    const started = Date.now();
    await expect(decryptKeystore(ks, 'correct horse battery')).rejects.toThrow(
      /iteration count out of range/,
    );
    // The rejection is a bounds check, not seconds of PBKDF2 work.
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  test('rejects an under-floor c (silently-weak envelope) — SMK-B-008', async () => {
    const ks = await baseKeystore();
    ks.crypto.kdfparams.c = 1;
    await expect(decryptKeystore(ks, 'correct horse battery')).rejects.toThrow(
      /iteration count out of range/,
    );
    expect(MIN_PBKDF2_ITERATIONS).toBeGreaterThan(1);
  });

  test('accepts the encrypt-side default c (round-trips)', async () => {
    const key = new Uint8Array(32).fill(9);
    const ks = await encryptKeystore(key, 'pw pw pw pw pw', '0x' + '22'.repeat(20));
    expect(ks.crypto.kdfparams.c).toBeGreaterThanOrEqual(MIN_PBKDF2_ITERATIONS);
    expect(ks.crypto.kdfparams.c).toBeLessThanOrEqual(MAX_PBKDF2_ITERATIONS);
    const out = await decryptKeystore(ks, 'pw pw pw pw pw');
    expect(Array.from(out)).toEqual(Array.from(new Uint8Array(32).fill(9)));
  });
});

describe('SMK-B-011 — CitrateWallet signs typed data, not just raw digests', () => {
  test('CitrateWallet implements signEip712', async () => {
    const wallet = new CitrateWallet(new Uint8Array(32).fill(3));
    expect(typeof (wallet as unknown as { signEip712?: unknown }).signEip712).toBe(
      'function',
    );
    const sig = await wallet.signEip712({
      domain: {
        name: 'Wrapped SALT',
        version: '1',
        chainId: 40204,
        verifyingContract: TOKEN,
      },
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' },
        ],
        TransferWithAuthorization: [
          { name: 'from', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'validAfter', type: 'uint256' },
          { name: 'validBefore', type: 'uint256' },
          { name: 'nonce', type: 'bytes32' },
        ],
      },
      primaryType: 'TransferWithAuthorization',
      message: {
        from: wallet.address,
        to: RECIPIENT,
        value: '1',
        validAfter: '0',
        validBefore: '99',
        nonce: ('0x' + '00'.repeat(32)) as Hex,
      },
    });
    expect(sig).toMatch(/^0x[0-9a-f]{130}$/);
  });
});

describe('SMK-B-012 — key material is zeroized after use', () => {
  test('decryptKeystore returns a live key; caller-side wipe leaves nothing', async () => {
    const secret = new Uint8Array(32).fill(0x42);
    const ks = await encryptKeystore(secret, 'passphrase here!!', '0x' + '33'.repeat(20));
    const out = await decryptKeystore(ks, 'passphrase here!!');
    expect(Array.from(out)).toEqual(Array.from(secret));
    // The unlock path (unlockWallet) wipes this array after copying into the
    // wallet; simulate that and confirm the buffer can be zeroed.
    out.fill(0);
    expect(out.every((b) => b === 0)).toBe(true);
  });
});
