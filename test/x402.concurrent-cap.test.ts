// PBA-L3b-002: maxTotalWei (SMK-B-003) was check -> await sign -> charge. N
// concurrent send() calls all passed the check before any charged spentWei, so
// the lifetime cap was bypassed N-fold (audit PoC: 10 authorizations under a
// cap of 2). The amount is now reserved synchronously right after the check,
// before any await, and released only if signing itself fails.
import { describe, expect, test, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import type { Address, Hex } from 'viem';
import { X402Client, type Signer } from '../src/x402.js';

const account = privateKeyToAccount(('0x' + '11'.repeat(32)) as Hex);
const TOKEN = ('0x' + 'b1'.repeat(20)) as Address;
const RECIPIENT = ('0x' + 'a2'.repeat(20)) as Address;
const AMOUNT = 10n ** 18n;

function gateway(opts: { paidStatus?: number } = {}) {
  let n = 0;
  const seen: string[] = [];
  const fetchMock = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
    const hdr = new Headers(init?.headers).get('x-payment');
    if (hdr) {
      seen.push(hdr);
      return new Response('{}', { status: opts.paidStatus ?? 500 });
    }
    const now = Math.floor(Date.now() / 1000);
    return new Response(
      JSON.stringify({
        x402: {
          version: 1, facilitator: '0x' + 'fa'.repeat(20), token: TOKEN, chain_id: 40204,
          amount: AMOUNT.toString(), nonce: '0x' + String(n++).padStart(64, '0'),
          valid_after: now - 60, valid_before: now + 120, recipient: RECIPIENT,
          digest: '0x' + '00'.repeat(32),
        },
      }),
      { status: 402, headers: { 'content-type': 'application/json' } },
    );
  });
  return { fetchMock, seen };
}

function client(fetchMock: typeof fetch, cap: bigint, signer: Signer = account) {
  return new X402Client({
    signer, chainId: 40204, allowedTokens: [TOKEN], allowedRecipients: [RECIPIENT],
    maxPayWei: AMOUNT, maxTotalWei: cap, fetch: fetchMock,
  });
}

describe('PBA-L3b-002: maxTotalWei holds under concurrency', () => {
  test('10 concurrent sends under a cap of 2 surrender at most 2 authorizations', async () => {
    const { fetchMock, seen } = gateway();
    const c = client(fetchMock as unknown as typeof fetch, 2n * AMOUNT);
    const res = await Promise.all(Array.from({ length: 10 }, () => c.send('http://gw/v1/chat/completions')));
    expect(seen.length).toBe(2);
    expect(c.totalSpentWei).toBe(2n * AMOUNT);
    expect(c.payments).toHaveLength(2);
    // The other 8 get their original 402 back, unsigned.
    expect(res.filter((r) => r.status === 402)).toHaveLength(8);
  });

  test('a cap that fits exactly one payment allows exactly one under concurrency', async () => {
    const { fetchMock, seen } = gateway({ paidStatus: 200 });
    const c = client(fetchMock as unknown as typeof fetch, AMOUNT);
    await Promise.all(Array.from({ length: 5 }, () => c.send('http://gw/x')));
    expect(seen.length).toBe(1);
    expect(c.totalSpentWei).toBe(AMOUNT);
  });

  test('a signing failure releases its reservation', async () => {
    const { fetchMock, seen } = gateway({ paidStatus: 200 });
    let calls = 0;
    const flaky: Signer = {
      address: account.address,
      sign: async (args: { hash: Hex }) => {
        calls++;
        if (calls === 1) throw new Error('hardware wallet unplugged');
        return account.sign(args);
      },
    };
    const c = client(fetchMock as unknown as typeof fetch, AMOUNT, flaky);
    await expect(c.send('http://gw/x')).rejects.toThrow(/unplugged/);
    expect(c.totalSpentWei).toBe(0n);
    const ok = await c.send('http://gw/x');
    expect(ok.status).toBe(200);
    expect(seen.length).toBe(1);
    expect(c.totalSpentWei).toBe(AMOUNT);
  });
});

// Mutation hardening for X402Client.send (Stryker survivors in the changed function).
describe('X402Client.send edges', () => {
  function challengeBody(over: Record<string, unknown> = {}) {
    const now = Math.floor(Date.now() / 1000);
    return {
      x402: {
        version: 1, facilitator: '0x' + 'fa'.repeat(20), token: TOKEN, chain_id: 40204,
        amount: AMOUNT.toString(), nonce: '0x' + '01'.padStart(64, '0'),
        valid_after: now - 60, valid_before: now + 120, recipient: RECIPIENT,
        digest: '0x' + '00'.repeat(32), ...over,
      },
    };
  }
  function fetchSeq(first: Response, paid?: () => Promise<Response>) {
    const seen: string[] = [];
    const f = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      const hdr = new Headers(init?.headers).get('x-payment');
      if (hdr) {
        seen.push(hdr);
        return paid ? paid() : new Response('{}', { status: 200 });
      }
      return first.clone();
    });
    return { f: f as unknown as typeof fetch, seen };
  }
  const json402 = (b: unknown) => new Response(JSON.stringify(b), { status: 402, headers: { 'content-type': 'application/json' } });

  test('records exactly what was signed, served=false until the paid retry answers', async () => {
    const { f } = fetchSeq(json402(challengeBody()), async () => { throw new Error('network down'); });
    const c = client(f, 2n * AMOUNT);
    await expect(c.send('http://gw/x')).rejects.toThrow(/network down/);
    expect(c.payments).toEqual([{ to: RECIPIENT, value: AMOUNT, nonce: '0x' + '01'.padStart(64, '0'), served: false }]);
  });

  test('a non-402 response is returned untouched even if it carries a challenge', async () => {
    const { f, seen } = fetchSeq(new Response(JSON.stringify(challengeBody()), { status: 200 }));
    const r = await client(f, AMOUNT).send('http://gw/x');
    expect(r.status).toBe(200);
    expect(seen).toHaveLength(0);
  });

  test('a 402 with a non-JSON body is returned unsigned', async () => {
    const { f, seen } = fetchSeq(new Response('<html>pay</html>', { status: 402 }));
    const r = await client(f, AMOUNT).send('http://gw/x');
    expect(r.status).toBe(402);
    expect(seen).toHaveLength(0);
  });

  test('multi-entry allowlists accept a challenge matching any entry', async () => {
    const { f, seen } = fetchSeq(json402(challengeBody()));
    const c = new X402Client({
      signer: account, chainId: 40204,
      allowedTokens: [('0x' + 'c3'.repeat(20)) as Address, TOKEN],
      allowedRecipients: [('0x' + 'd4'.repeat(20)) as Address, RECIPIENT],
      maxPayWei: AMOUNT, maxTotalWei: AMOUNT, fetch: f,
    });
    expect((await c.send('http://gw/x')).status).toBe(200);
    expect(seen).toHaveLength(1);
  });

  test('an authorization expiring exactly now is not signed', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-25T00:00:00Z'));
      const now = Math.floor(Date.now() / 1000);
      const { f, seen } = fetchSeq(json402(challengeBody({ valid_after: now - 60, valid_before: now })));
      const r = await client(f, AMOUNT).send('http://gw/x');
      expect(r.status).toBe(402);
      expect(seen).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
