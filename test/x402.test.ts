// x402 TS port — internal-consistency + integration tests.
//
// Goldens against the Rust impl will land once we add cross-language
// fixtures (CM-04 WP-04.1 slice 2 generator). For now we lock:
//   - byte layout of PaymentPayload (round-trip)
//   - URL-safe base64 codec round-trip
//   - deterministic digest computation
//   - X402Client auto-pay-on-402 flow against a mock fetch

import { describe, expect, test, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import type { Address, Hex } from 'viem';

import {
  bytesToPayment,
  decodePaymentHeader,
  eip712Digest,
  encodePaymentHeader,
  PAYLOAD_BYTES,
  paymentToBytes,
  signChallenge,
  transferWithAuthorizationStructHash,
  wsaltDomainSeparator,
  X402Client,
  type PaymentChallenge,
  type PaymentPayload,
} from '../src/x402.js';

// Deterministic test private key — also used by CM-02's Rust client
// tests as `payer_secret()`. Same key produces the same address +
// signatures, which is what makes RFC-6979 ECDSA testable.
const TEST_PRIVATE_KEY: Hex =
  '0x1122334455667788' +
  '99aabbccddee0011' +
  '2233445566778899' +
  'aabbccddee001122' as Hex;

function samplePayload(): PaymentPayload {
  return {
    from: ('0x' + 'a1'.repeat(20)) as Address,
    to: ('0x' + 'a2'.repeat(20)) as Address,
    value: 1_000_000_000_000_000_000n,
    validAfter: 1_714_000_000n,
    validBefore: 1_714_000_300n,
    nonce: ('0x' + 'cd'.repeat(32)) as Hex,
    v: 27,
    r: ('0x' + '11'.repeat(32)) as Hex,
    s: ('0x' + '22'.repeat(32)) as Hex,
  };
}

describe('payment wire layout', () => {
  test('paymentToBytes produces exactly PAYLOAD_BYTES bytes', () => {
    const out = paymentToBytes(samplePayload());
    expect(out.length).toBe(PAYLOAD_BYTES);
    expect(PAYLOAD_BYTES).toBe(233);
  });

  test('round-trip: bytes → payload → bytes is byte-identical', () => {
    const p = samplePayload();
    const bytes = paymentToBytes(p);
    const p2 = bytesToPayment(bytes);
    const bytes2 = paymentToBytes(p2);
    expect(Array.from(bytes2)).toEqual(Array.from(bytes));
    expect(p2.from).toBe(p.from);
    expect(p2.value).toBe(p.value);
    expect(p2.v).toBe(p.v);
  });

  test('bytesToPayment rejects wrong length', () => {
    expect(() => bytesToPayment(new Uint8Array(232))).toThrow(/233/);
    expect(() => bytesToPayment(new Uint8Array(234))).toThrow(/233/);
  });
});

describe('X-PAYMENT header codec', () => {
  test('round-trips via URL-safe base64', () => {
    const p = samplePayload();
    const header = encodePaymentHeader(p);
    expect(header).not.toContain('=');
    expect(header).not.toContain('+');
    expect(header).not.toContain('/');
    const p2 = decodePaymentHeader(header);
    expect(p2).toEqual(p);
  });

  test('decodes whitespace-tolerantly', () => {
    const p = samplePayload();
    const header = encodePaymentHeader(p);
    const p2 = decodePaymentHeader('  ' + header + '\n');
    expect(p2.from).toBe(p.from);
  });
});

describe('EIP-712 digest', () => {
  const chainId = 40204;
  const wsalt: Address = '0x8951ae72e5479cae28ef7bb3caa4207d5719e24b';

  test('domain separator is deterministic', () => {
    const a = wsaltDomainSeparator(chainId, wsalt);
    const b = wsaltDomainSeparator(chainId, wsalt);
    expect(a).toBe(b);
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
  });

  test('domain separator changes with chain id', () => {
    const a = wsaltDomainSeparator(chainId, wsalt);
    const b = wsaltDomainSeparator(chainId + 1, wsalt);
    expect(a).not.toBe(b);
  });

  test('struct hash is deterministic and changes with from', () => {
    const args = {
      from: ('0x' + 'a1'.repeat(20)) as Address,
      to: ('0x' + 'a2'.repeat(20)) as Address,
      value: 1_000_000_000_000_000_000n,
      validAfter: 1n,
      validBefore: 999n,
      nonce: ('0x' + 'cd'.repeat(32)) as Hex,
    };
    const h1 = transferWithAuthorizationStructHash(args);
    const h2 = transferWithAuthorizationStructHash(args);
    expect(h1).toBe(h2);
    const h3 = transferWithAuthorizationStructHash({
      ...args,
      from: ('0x' + 'b1'.repeat(20)) as Address,
    });
    expect(h3).not.toBe(h1);
  });

  test('digest = keccak256(0x1901 || domain || structHash)', () => {
    const domain = wsaltDomainSeparator(chainId, wsalt);
    const sh = transferWithAuthorizationStructHash({
      from: ('0x' + 'a1'.repeat(20)) as Address,
      to: ('0x' + 'a2'.repeat(20)) as Address,
      value: 100n,
      validAfter: 1n,
      validBefore: 999n,
      nonce: ('0x' + 'cd'.repeat(32)) as Hex,
    });
    const d1 = eip712Digest({ domainSeparator: domain, structHash: sh });
    const d2 = eip712Digest({ domainSeparator: domain, structHash: sh });
    expect(d1).toBe(d2);
    expect(d1).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe('signChallenge', () => {
  test('produces a payload with the signer as `from`', async () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    const challenge: PaymentChallenge = {
      version: 1,
      facilitator: ('0x' + 'fa'.repeat(20)) as Address,
      token: '0x8951ae72e5479cae28ef7bb3caa4207d5719e24b',
      chain_id: 40204,
      amount: '1000000000000000000',
      nonce: ('0x' + '77'.repeat(32)) as Hex,
      valid_after: 1_714_000_000,
      valid_before: 1_714_000_300,
      recipient: ('0x' + 'a2'.repeat(20)) as Address,
      digest: ('0x' + '00'.repeat(32)) as Hex, // server preview, not used
    };

    const payload = await signChallenge(challenge, account);
    expect(payload.from.toLowerCase()).toBe(account.address.toLowerCase());
    expect(payload.to).toBe(challenge.recipient);
    expect(payload.value).toBe(BigInt(challenge.amount));
    expect(payload.nonce).toBe(challenge.nonce);
    expect([27, 28]).toContain(payload.v);
  });

  test('is deterministic — RFC 6979', async () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    const challenge: PaymentChallenge = {
      version: 1,
      facilitator: ('0x' + 'fa'.repeat(20)) as Address,
      token: '0x8951ae72e5479cae28ef7bb3caa4207d5719e24b',
      chain_id: 40204,
      amount: '1000000000000000000',
      nonce: ('0x' + '77'.repeat(32)) as Hex,
      valid_after: 1_714_000_000,
      valid_before: 1_714_000_300,
      recipient: ('0x' + 'a2'.repeat(20)) as Address,
      digest: ('0x' + '00'.repeat(32)) as Hex,
    };
    const a = await signChallenge(challenge, account);
    const b = await signChallenge(challenge, account);
    expect(a.r).toBe(b.r);
    expect(a.s).toBe(b.s);
    expect(a.v).toBe(b.v);
  });
});

describe('X402Client.send', () => {
  const account = privateKeyToAccount(TEST_PRIVATE_KEY);
  // Client policy matching the test challenge() below (RM-C mandatory binding).
  const TOKEN = '0x8951ae72e5479cae28ef7bb3caa4207d5719e24b' as Address;
  // The payee the challenge() fixture below names — pinned in-policy now that
  // allowedRecipients is required (SMK-B-002).
  const RECIPIENT = ('0x' + 'a2'.repeat(20)) as Address;
  const MAX = 10_000_000_000_000_000_000_000n;

  function challenge(amount = '1000000000000000000'): PaymentChallenge {
    // Live validity window — send() now refuses to sign an expired
    // challenge (SECREM-02 5.3 / -003), so fixtures must be fresh.
    const now = Math.floor(Date.now() / 1000);
    return {
      version: 1,
      facilitator: ('0x' + 'fa'.repeat(20)) as Address,
      token: '0x8951ae72e5479cae28ef7bb3caa4207d5719e24b',
      chain_id: 40204,
      amount,
      nonce: ('0x' + '77'.repeat(32)) as Hex,
      valid_after: now - 60,
      valid_before: now + 300,
      recipient: ('0x' + 'a2'.repeat(20)) as Address,
      digest: ('0x' + '00'.repeat(32)) as Hex,
    };
  }

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  test('200 response is returned untouched', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ object: 'chat.completion' }, 200),
    );
    const client = new X402Client({
      signer: account,
      fetch: fetchMock,
      chainId: 40204,
      allowedTokens: [TOKEN],
      allowedRecipients: [RECIPIENT],
      maxPayWei: MAX,
      maxTotalWei: MAX,
    });
    const resp = await client.send('http://gw/v1/chat/completions');
    expect(resp.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('402 with challenge → sign + retry → forwards X-PAYMENT', async () => {
    const fetchMock = vi
      .fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        if (headers.has('x-payment')) {
          return jsonResponse({ object: 'chat.completion' }, 200);
        }
        return jsonResponse({ x402: challenge() }, 402);
      });
    const client = new X402Client({
      signer: account,
      fetch: fetchMock,
      chainId: 40204,
      allowedTokens: [TOKEN],
      allowedRecipients: [RECIPIENT],
      maxPayWei: MAX,
      maxTotalWei: MAX,
    });
    const resp = await client.send('http://gw/v1/chat/completions', {
      method: 'POST',
    });
    expect(resp.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondCallInit = fetchMock.mock.calls[1][1] as RequestInit;
    const xpayHeader = new Headers(secondCallInit.headers).get('x-payment');
    expect(xpayHeader).toBeTruthy();
    expect(xpayHeader!.length).toBeGreaterThan(40);
  });

  test('402 above maxPayWei is returned without signing', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ x402: challenge('999000000000000000000') }, 402),
    );
    const client = new X402Client({
      signer: account,
      fetch: fetchMock,
      chainId: 40204,
      allowedTokens: [TOKEN],
      allowedRecipients: [RECIPIENT],
      maxPayWei: 1n,
      maxTotalWei: MAX,
    });
    const resp = await client.send('http://gw/v1/chat/completions');
    expect(resp.status).toBe(402);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('402 without parseable challenge is returned untouched', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: 'something else' }, 402),
    );
    const client = new X402Client({
      signer: account,
      fetch: fetchMock,
      chainId: 40204,
      allowedTokens: [TOKEN],
      allowedRecipients: [RECIPIENT],
      maxPayWei: MAX,
      maxTotalWei: MAX,
    });
    const resp = await client.send('http://gw/v1/chat/completions');
    expect(resp.status).toBe(402);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('5xx is returned without retry', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: 'down' }, 503),
    );
    const client = new X402Client({
      signer: account,
      fetch: fetchMock,
      chainId: 40204,
      allowedTokens: [TOKEN],
      allowedRecipients: [RECIPIENT],
      maxPayWei: MAX,
      maxTotalWei: MAX,
    });
    const resp = await client.send('http://gw/v1/chat/completions');
    expect(resp.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // ── RM-C CITRATE_SDK_MARKETPLACE-002 binding tripwires ──
  // Each serves a 402 the server controls; the client must REFUSE to sign
  // (return the 402, fetch called once — no sign+retry) when a bound field
  // doesn't match its policy.
  test('TRIPWIRE: 402 on a different chain is refused', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ x402: { ...challenge(), chain_id: 99999 } }, 402),
    );
    const client = new X402Client({
      signer: account, fetch: fetchMock, chainId: 40204, allowedTokens: [TOKEN],
      allowedRecipients: [RECIPIENT], maxPayWei: MAX, maxTotalWei: MAX,
    });
    const resp = await client.send('http://gw/v1/chat/completions');
    expect(resp.status).toBe(402);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('TRIPWIRE: 402 for a non-allowlisted token is refused', async () => {
    const evilToken = ('0x' + 'be'.repeat(20)) as Address;
    const fetchMock = vi.fn(async () =>
      jsonResponse({ x402: { ...challenge(), token: evilToken } }, 402),
    );
    const client = new X402Client({
      signer: account, fetch: fetchMock, chainId: 40204, allowedTokens: [TOKEN],
      allowedRecipients: [RECIPIENT], maxPayWei: MAX, maxTotalWei: MAX,
    });
    const resp = await client.send('http://gw/v1/chat/completions');
    expect(resp.status).toBe(402);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('TRIPWIRE: 402 to a non-pinned recipient is refused when recipients are pinned', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ x402: challenge() }, 402));
    const client = new X402Client({
      signer: account, fetch: fetchMock, chainId: 40204, allowedTokens: [TOKEN], maxPayWei: MAX,
      maxTotalWei: MAX,
      allowedRecipients: [('0x' + 'c3'.repeat(20)) as Address],
    });
    const resp = await client.send('http://gw/v1/chat/completions');
    expect(resp.status).toBe(402);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
