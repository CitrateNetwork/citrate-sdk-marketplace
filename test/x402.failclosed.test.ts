// SECREM-02 5.3 — fail-closed spend-policy tripwires.
//
// FUA-SDK-MKT-01: the X402Client payment policy must be enforced at
// RUNTIME, not just by TypeScript types. A plain-JS consumer (or any
// `as any` cast) that omits `maxPayWei` must get a construction-time
// error — never a silent uncapped auto-pay (`BigInt(amount) >
// undefined` evaluates to `false`).
//
// CITRATE_SDK_MARKETPLACE-2026-05-31-003: the server's 402 challenge
// is untrusted input. Malformed fields must make `send` return the
// original 402 unsigned (fail closed, contract preserved) — never
// throw mid-send and never sign.

import { describe, expect, test, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import type { Address, Hex } from 'viem';

import {
  X402Client,
  type PaymentChallenge,
  type X402ClientOptions,
} from '../src/x402.js';

const TEST_PRIVATE_KEY: Hex =
  '0x1122334455667788' +
  '99aabbccddee0011' +
  '2233445566778899' +
  'aabbccddee001122' as Hex;

const account = privateKeyToAccount(TEST_PRIVATE_KEY);
const TOKEN = '0x8951ae72e5479cae28ef7bb3caa4207d5719e24b' as Address;
const MAX = 10_000_000_000_000_000_000_000n;

function validOpts(): X402ClientOptions {
  return {
    signer: account,
    chainId: 40204,
    allowedTokens: [TOKEN],
    maxPayWei: MAX,
  };
}

/// In-policy challenge with a live validity window.
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
    valid_before: now + 300,
    recipient: ('0x' + 'a2'.repeat(20)) as Address,
    digest: ('0x' + '00'.repeat(32)) as Hex,
  };
  return { ...base, ...overrides };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/// Mock gateway: serves the supplied challenge on the first request,
/// 200 if the client comes back with an x-payment header.
function gatewayFetch(c: Record<string, unknown>) {
  return vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (headers.has('x-payment')) {
      return jsonResponse({ object: 'chat.completion' }, 200);
    }
    return jsonResponse({ x402: c }, 402);
  });
}

describe('FUA-SDK-MKT-01: constructor fails CLOSED on a missing/invalid policy', () => {
  test('TRIPWIRE: omitted maxPayWei throws (no implicit unlimited mode)', () => {
    const { maxPayWei: _drop, ...rest } = validOpts();
    expect(() => new X402Client(rest as unknown as X402ClientOptions)).toThrow(
      /maxPayWei/,
    );
  });

  test('TRIPWIRE: undefined maxPayWei throws', () => {
    const opts = { ...validOpts(), maxPayWei: undefined };
    expect(() => new X402Client(opts as unknown as X402ClientOptions)).toThrow(
      /maxPayWei/,
    );
  });

  test('TRIPWIRE: non-bigint maxPayWei (JS number) throws', () => {
    const opts = { ...validOpts(), maxPayWei: 1000000 };
    expect(() => new X402Client(opts as unknown as X402ClientOptions)).toThrow(
      /maxPayWei/,
    );
  });

  test('TRIPWIRE: non-bigint maxPayWei (string) throws', () => {
    const opts = { ...validOpts(), maxPayWei: '1000000' };
    expect(() => new X402Client(opts as unknown as X402ClientOptions)).toThrow(
      /maxPayWei/,
    );
  });

  test('TRIPWIRE: negative maxPayWei throws', () => {
    const opts = { ...validOpts(), maxPayWei: -1n };
    expect(() => new X402Client(opts as unknown as X402ClientOptions)).toThrow(
      /maxPayWei/,
    );
  });

  test('TRIPWIRE: omitted chainId throws', () => {
    const { chainId: _drop, ...rest } = validOpts();
    expect(() => new X402Client(rest as unknown as X402ClientOptions)).toThrow(
      /chainId/,
    );
  });

  test('TRIPWIRE: non-integer chainId throws', () => {
    const opts = { ...validOpts(), chainId: 40204.5 };
    expect(() => new X402Client(opts as unknown as X402ClientOptions)).toThrow(
      /chainId/,
    );
  });

  test('TRIPWIRE: omitted allowedTokens throws', () => {
    const { allowedTokens: _drop, ...rest } = validOpts();
    expect(() => new X402Client(rest as unknown as X402ClientOptions)).toThrow(
      /allowedTokens/,
    );
  });

  test('TRIPWIRE: empty allowedTokens throws', () => {
    const opts = { ...validOpts(), allowedTokens: [] };
    expect(() => new X402Client(opts as unknown as X402ClientOptions)).toThrow(
      /allowedTokens/,
    );
  });

  test('TRIPWIRE: malformed allowedTokens entry throws', () => {
    const opts = { ...validOpts(), allowedTokens: ['not-an-address'] };
    expect(() => new X402Client(opts as unknown as X402ClientOptions)).toThrow(
      /allowedTokens/,
    );
  });

  test('TRIPWIRE: empty allowedRecipients (when provided) throws', () => {
    const opts = { ...validOpts(), allowedRecipients: [] };
    expect(() => new X402Client(opts as unknown as X402ClientOptions)).toThrow(
      /allowedRecipients/,
    );
  });

  test('TRIPWIRE: malformed allowedRecipients entry throws', () => {
    const opts = { ...validOpts(), allowedRecipients: ['0x123'] };
    expect(() => new X402Client(opts as unknown as X402ClientOptions)).toThrow(
      /allowedRecipients/,
    );
  });

  test('a fully-specified valid policy constructs fine', () => {
    expect(
      () =>
        new X402Client({
          ...validOpts(),
          allowedRecipients: [('0x' + 'a2'.repeat(20)) as Address],
        }),
    ).not.toThrow();
  });
});

describe('-003: malformed challenge fields fail CLOSED (return the 402, never throw, never sign)', () => {
  test('TRIPWIRE: non-decimal amount → original 402 returned unsigned', async () => {
    const fetchMock = gatewayFetch(challenge({ amount: 'DROP TABLE payments' }));
    const client = new X402Client({ ...validOpts(), fetch: fetchMock });
    const resp = await client.send('http://gw/v1/chat/completions');
    expect(resp.status).toBe(402);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('TRIPWIRE: numeric (non-string) amount → original 402 returned unsigned', async () => {
    const fetchMock = gatewayFetch(challenge({ amount: 1e30 }));
    const client = new X402Client({ ...validOpts(), fetch: fetchMock });
    const resp = await client.send('http://gw/v1/chat/completions');
    expect(resp.status).toBe(402);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('TRIPWIRE: malformed nonce → original 402 returned unsigned', async () => {
    const fetchMock = gatewayFetch(challenge({ nonce: 'garbage' }));
    const client = new X402Client({ ...validOpts(), fetch: fetchMock });
    const resp = await client.send('http://gw/v1/chat/completions');
    expect(resp.status).toBe(402);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('TRIPWIRE: malformed recipient → original 402 returned unsigned', async () => {
    const fetchMock = gatewayFetch(challenge({ recipient: 'attacker' }));
    const client = new X402Client({ ...validOpts(), fetch: fetchMock });
    const resp = await client.send('http://gw/v1/chat/completions');
    expect(resp.status).toBe(402);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('TRIPWIRE: incoherent validity window (valid_after >= valid_before) → 402 unsigned', async () => {
    const now = Math.floor(Date.now() / 1000);
    const fetchMock = gatewayFetch(
      challenge({ valid_after: now + 600, valid_before: now + 300 }),
    );
    const client = new X402Client({ ...validOpts(), fetch: fetchMock });
    const resp = await client.send('http://gw/v1/chat/completions');
    expect(resp.status).toBe(402);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('TRIPWIRE: non-integer validity bounds → 402 unsigned', async () => {
    const fetchMock = gatewayFetch(
      challenge({ valid_after: 'soon', valid_before: 'later' }),
    );
    const client = new X402Client({ ...validOpts(), fetch: fetchMock });
    const resp = await client.send('http://gw/v1/chat/completions');
    expect(resp.status).toBe(402);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('TRIPWIRE: already-expired window → 402 unsigned (no point signing a dead auth)', async () => {
    const now = Math.floor(Date.now() / 1000);
    const fetchMock = gatewayFetch(
      challenge({ valid_after: now - 600, valid_before: now - 300 }),
    );
    const client = new X402Client({ ...validOpts(), fetch: fetchMock });
    const resp = await client.send('http://gw/v1/chat/completions');
    expect(resp.status).toBe(402);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('a fully-valid in-policy challenge still signs and retries (no over-rejection)', async () => {
    const fetchMock = gatewayFetch(challenge());
    const client = new X402Client({ ...validOpts(), fetch: fetchMock });
    const resp = await client.send('http://gw/v1/chat/completions');
    expect(resp.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
