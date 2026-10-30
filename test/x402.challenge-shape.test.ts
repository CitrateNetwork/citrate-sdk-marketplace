// X402Client.send treats the 402 challenge as untrusted input: each field is
// shape-checked before use. A malformed field must make `send` hand back the
// original 402 unsigned — it must not sign, and it must not throw mid-send.
//
// These cases pin each per-field check at the `send` entry point. The
// neighbouring policy checks (chain / token / recipient pins, cap, window)
// mask some of them for "nearly valid" values, so each case below uses a
// value that only the per-field check stops.

import { describe, expect, test, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import type { Address, Hex } from 'viem';

import {
  X402Client,
  type PaymentChallenge,
  type X402ClientOptions,
} from '../src/x402.js';

const account = privateKeyToAccount(
  ('0x' + '1122334455667788' + '99aabbccddee0011' + '2233445566778899' + 'aabbccddee001122') as Hex,
);
const TOKEN = '0x8951ae72e5479cae28ef7bb3caa4207d5719e24b' as Address;
const RECIPIENT = ('0x' + 'a2'.repeat(20)) as Address;
const MAX = 10_000_000_000_000_000_000_000n;

function client(fetchImpl: typeof fetch): X402Client {
  const opts: X402ClientOptions = {
    signer: account,
    chainId: 40204,
    allowedTokens: [TOKEN],
    allowedRecipients: [RECIPIENT],
    maxPayWei: MAX,
    maxTotalWei: MAX,
    fetch: fetchImpl,
  };
  return new X402Client(opts);
}

function challenge(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
  return { ...base, ...overrides };
}

function gateway(c: Record<string, unknown>) {
  return vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (headers.has('x-payment')) {
      return new Response('{"ok":true}', { status: 200 });
    }
    return new Response(JSON.stringify({ x402: c }), {
      status: 402,
      headers: { 'content-type': 'application/json' },
    });
  });
}

async function expectUnsigned402(c: Record<string, unknown>): Promise<void> {
  const fetchImpl = gateway(c);
  const x = client(fetchImpl as unknown as typeof fetch);
  const res = await x.send('https://gw.example/v1/chat');
  expect(res.status).toBe(402);
  // One request only: no paid retry, so nothing was signed.
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(x.totalSpentWei).toBe(0n);
  expect(x.payments).toEqual([]);
}

describe('X402Client.send: per-field challenge checks', () => {
  test('control: a well-formed in-policy challenge is paid', async () => {
    const fetchImpl = gateway(challenge());
    const x = client(fetchImpl as unknown as typeof fetch);
    const res = await x.send('https://gw.example/v1/chat');
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(x.totalSpentWei).toBe(1_000_000_000_000_000_000n);
  });

  test('a non-numeric version is not signed', async () => {
    await expectUnsigned402(challenge({ version: '1' }));
  });

  test('a non-integer version is not signed', async () => {
    await expectUnsigned402(challenge({ version: 1.5 }));
  });

  test('a malformed facilitator address is not signed', async () => {
    await expectUnsigned402(challenge({ facilitator: '0x1234' }));
  });

  test('a non-string token is refused without throwing', async () => {
    await expectUnsigned402(challenge({ token: 12345 }));
  });

  test('a non-string recipient is refused without throwing', async () => {
    await expectUnsigned402(challenge({ recipient: 12345 }));
  });

  test('a negative valid_after is not signed', async () => {
    await expectUnsigned402(challenge({ valid_after: -1 }));
  });

  test('a fractional valid_after is refused without throwing', async () => {
    const now = Math.floor(Date.now() / 1000);
    await expectUnsigned402(challenge({ valid_after: now - 0.5 }));
  });

  test('a fractional valid_before is refused without throwing', async () => {
    const now = Math.floor(Date.now() / 1000);
    await expectUnsigned402(challenge({ valid_before: now + 60.5 }));
  });

  test('a string valid_before is refused without throwing', async () => {
    const now = Math.floor(Date.now() / 1000);
    await expectUnsigned402(challenge({ valid_before: String(now + 60) }));
  });

  test('a malformed digest is not signed', async () => {
    await expectUnsigned402(challenge({ digest: '0xabc' }));
  });

  test('a missing digest is not signed', async () => {
    const c = challenge();
    delete c.digest;
    await expectUnsigned402(c);
  });
});
