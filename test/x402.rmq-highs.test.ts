// RM-Q Leg-B HIGH tripwires — SMK-B-001 / SMK-B-002 / SMK-B-003.
//
// RC-8: each block encodes the exact defect the audit reported and then
// asserts the fixed behaviour, so the test is RED against the pinned
// (a8d21193) source and GREEN only once the fix lands. Do not soften an
// assertion to make the suite pass — that re-opens the finding.
//
//   SMK-B-001  publish.yml interpolates a free-text workflow_dispatch input
//              into a run: block holding NPM_TOKEN → command execution.
//   SMK-B-002  allowedRecipients was OPTIONAL → the 402 server chose the payee
//              by default while every other check passed.
//   SMK-B-003  no cumulative spend cap and no proof-of-service → an agent loop
//              surrenders N × maxPayWei to a server that never serves.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import type { Address, Hex } from 'viem';

import { X402Client, type X402ClientOptions } from '../src/x402.js';

const here = dirname(fileURLToPath(import.meta.url));

// ── shared x402 fixtures ────────────────────────────────────────
const TEST_PRIVATE_KEY: Hex =
  '0x1122334455667788' +
  '99aabbccddee0011' +
  '2233445566778899' +
  'aabbccddee001122' as Hex;
const account = privateKeyToAccount(TEST_PRIVATE_KEY);
const TOKEN = '0x8951ae72e5479cae28ef7bb3caa4207d5719e24b' as Address;
const RECIPIENT = ('0x' + 'a2'.repeat(20)) as Address;
const AMOUNT = 1_000_000_000_000_000_000n; // 1 token per challenge

function fullOpts(over: Partial<X402ClientOptions> = {}): X402ClientOptions {
  return {
    signer: account,
    chainId: 40204,
    allowedTokens: [TOKEN],
    allowedRecipients: [RECIPIENT],
    maxPayWei: AMOUNT,
    maxTotalWei: 2n * AMOUNT,
    ...over,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function challenge(over: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    version: 1,
    facilitator: ('0x' + 'fa'.repeat(20)) as Address,
    token: TOKEN,
    chain_id: 40204,
    amount: AMOUNT.toString(),
    nonce: ('0x' + '77'.repeat(32)) as Hex,
    valid_after: now - 60,
    valid_before: now + 300,
    recipient: RECIPIENT,
    digest: ('0x' + '00'.repeat(32)) as Hex,
    ...over,
  };
}

// ── SMK-B-001 — CI command injection in the publish workflow ────
describe('SMK-B-001: publish.yml does not interpolate dispatch input into a run: block', () => {
  const workflow = readFileSync(
    join(here, '..', '.github', 'workflows', 'publish.yml'),
    'utf8',
  );

  test('TRIPWIRE: no ${{ github.event.* }} expression appears inside a run: script', () => {
    // Extract each `run: |` block's body and assert none embeds a
    // github.event expression — GitHub expands ${{ }} into the script TEXT
    // before bash runs, so any such expression is a shell-injection sink.
    const runBlocks = workflow.match(/run:\s*\|([\s\S]*?)(?=\n {6}- |\n {4}\w|\n {2}\w|$)/g) ?? [];
    expect(runBlocks.length).toBeGreaterThan(0);
    for (const block of runBlocks) {
      expect(block).not.toMatch(/\$\{\{\s*github\.event/);
    }
  });

  test('the dist-tag reaches the script through env: and is allowlist-validated', () => {
    // The safe shape: the untrusted input is bound to an env var (data, never
    // script text) and checked against a strict allowlist before publish.
    expect(workflow).toMatch(/DIST_TAG:\s*\$\{\{\s*github\.event\.inputs\.tag/);
    expect(workflow).toMatch(/\^\(latest\|next\|beta\|rc\)\$/);
  });
});

// ── SMK-B-002 — payee not pinned by default ─────────────────────
describe('SMK-B-002: allowedRecipients is REQUIRED (payee must be pinned)', () => {
  test('TRIPWIRE: constructing without allowedRecipients throws', () => {
    const { allowedRecipients: _drop, ...rest } = fullOpts();
    expect(() => new X402Client(rest as unknown as X402ClientOptions)).toThrow(
      /allowedRecipients/,
    );
  });

  test('TRIPWIRE: undefined allowedRecipients throws', () => {
    const opts = { ...fullOpts(), allowedRecipients: undefined };
    expect(() => new X402Client(opts as unknown as X402ClientOptions)).toThrow(
      /allowedRecipients/,
    );
  });

  test('a client that pins the payee refuses a 402 naming an attacker recipient', async () => {
    const ATTACKER = ('0x' + 'ee'.repeat(20)) as Address;
    const fetchMock = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      if (new Headers(init?.headers).has('x-payment')) {
        return jsonResponse({ object: 'chat.completion' }, 200);
      }
      return jsonResponse({ x402: challenge({ recipient: ATTACKER }) }, 402);
    });
    const client = new X402Client(fullOpts({ fetch: fetchMock }));
    const resp = await client.send('http://gw/v1/chat/completions');
    expect(resp.status).toBe(402); // refused, never signed
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(client.totalSpentWei).toBe(0n);
  });
});

// ── SMK-B-003 — cumulative cap + proof-of-service ───────────────
describe('SMK-B-003: cumulative spend cap and proof-of-service ledger', () => {
  test('TRIPWIRE: constructing without maxTotalWei throws', () => {
    const { maxTotalWei: _drop, ...rest } = fullOpts();
    expect(() => new X402Client(rest as unknown as X402ClientOptions)).toThrow(
      /maxTotalWei/,
    );
  });

  test('TRIPWIRE: a server that always 500s cannot extract past maxTotalWei', async () => {
    const seen: string[] = [];
    let n = 0;
    // Fresh nonce each challenge; take the authorization, never serve (500).
    const fetchMock = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      const hdr = new Headers(init?.headers).get('x-payment');
      if (hdr) {
        seen.push(hdr);
        return jsonResponse({ error: 'down' }, 500);
      }
      const nonce = ('0x' + String(n++).padStart(64, '0')) as Hex;
      return jsonResponse({ x402: challenge({ nonce }) }, 402);
    });
    // Budget covers exactly two payments.
    const client = new X402Client(fullOpts({ fetch: fetchMock }));

    // Five attempts; only the first two are allowed to surrender an auth.
    for (let i = 0; i < 5; i++) {
      await client.send('http://gw/v1/chat/completions');
    }

    expect(seen.length).toBe(2); // extraction is bounded by the lifetime cap
    expect(new Set(seen).size).toBe(2); // two distinct authorizations
    expect(client.totalSpentWei).toBe(2n * AMOUNT); // never exceeds maxTotalWei
    expect(client.payments).toHaveLength(2);
    // Proof-of-service: both were paid-but-not-served.
    expect(client.payments.every((p) => p.served === false)).toBe(true);
  });

  test('served flag is true when the paid retry returns 2xx', async () => {
    const fetchMock = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      if (new Headers(init?.headers).has('x-payment')) {
        return jsonResponse({ object: 'chat.completion' }, 200);
      }
      return jsonResponse({ x402: challenge() }, 402);
    });
    const client = new X402Client(fullOpts({ fetch: fetchMock }));
    const resp = await client.send('http://gw/v1/chat/completions');
    expect(resp.status).toBe(200);
    expect(client.payments).toHaveLength(1);
    expect(client.payments[0].served).toBe(true);
    expect(client.totalSpentWei).toBe(AMOUNT);
  });
});
