// Entry-point pins for key-material hygiene in the local wallet:
//   - createWallet / unlockWallet wipe the plaintext private-key buffer once
//     it has been copied into the wallet;
//   - encryptKeystore / decryptKeystore wipe the PBKDF2-derived key;
//   - constantTimeEqual has no data-dependent early exit (source tripwire:
//     timing is not measurable reliably in a unit test).
//
// The buffers are observed by wrapping the WebCrypto calls that produce them
// (getRandomValues, deriveBits, decrypt): the SDK wraps those results in a
// Uint8Array view without copying, so a wipe is visible through the wrapper.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { clearKeystore, createWallet, unlockWallet } from '../src/wallet/citrate.js';
import { decryptKeystore, encryptKeystore } from '../src/wallet/keystore.js';

const PASS = 'correct-horse-battery-staple';
const KEY = () => new Uint8Array(32).map((_, i) => (i * 7 + 3) & 0xff);
const ADDR = '0x' + 'ab'.repeat(20);

function allZero(b: ArrayBuffer | Uint8Array): boolean {
  const v = b instanceof Uint8Array ? b : new Uint8Array(b);
  return v.length > 0 && v.every((x) => x === 0);
}

afterEach(() => {
  vi.restoreAllMocks();
  clearKeystore();
});

describe('derived-key wipe', () => {
  test('encryptKeystore wipes the PBKDF2 output once the MAC is computed', async () => {
    const subtle = globalThis.crypto.subtle;
    const orig = subtle.deriveBits.bind(subtle);
    const seen: ArrayBuffer[] = [];
    vi.spyOn(subtle, 'deriveBits').mockImplementation(async (...a: Parameters<SubtleCrypto['deriveBits']>) => {
      const out = await orig(...a);
      seen.push(out);
      return out;
    });
    await encryptKeystore(KEY(), PASS, ADDR as `0x${string}`);
    expect(seen).toHaveLength(1);
    expect(allZero(seen[0])).toBe(true);
  });

  test('decryptKeystore wipes the PBKDF2 output before returning', async () => {
    const ks = await encryptKeystore(KEY(), PASS, ADDR as `0x${string}`);
    const subtle = globalThis.crypto.subtle;
    const orig = subtle.deriveBits.bind(subtle);
    const seen: ArrayBuffer[] = [];
    vi.spyOn(subtle, 'deriveBits').mockImplementation(async (...a: Parameters<SubtleCrypto['deriveBits']>) => {
      const out = await orig(...a);
      seen.push(out);
      return out;
    });
    const pt = await decryptKeystore(ks, PASS);
    expect(Array.from(pt)).toEqual(Array.from(KEY()));
    expect(seen).toHaveLength(1);
    expect(allZero(seen[0])).toBe(true);
  });
});

describe('plaintext private-key wipe at the wallet entry points', () => {
  test('createWallet wipes the generated key buffer and the wallet still signs', async () => {
    const orig = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
    const filled: Uint8Array[] = [];
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(arr: T): T => {
      const out = orig(arr as never) as T;
      if (arr instanceof Uint8Array) filled.push(arr);
      return out;
    });
    const wallet = await createWallet(PASS);
    // The first 32-byte draw is the private key (salt/iv/uuid follow).
    expect(filled.length).toBeGreaterThan(0);
    expect(filled[0].length).toBe(32);
    expect(allZero(filled[0])).toBe(true);
    await expect(wallet.sign({ hash: ('0x' + '11'.repeat(32)) as `0x${string}` })).resolves.toMatch(/^0x[0-9a-f]{130}$/);
  });

  test('unlockWallet wipes the decrypted key buffer and the wallet still signs', async () => {
    const created = await createWallet(PASS);
    const subtle = globalThis.crypto.subtle;
    const orig = subtle.decrypt.bind(subtle);
    const seen: ArrayBuffer[] = [];
    vi.spyOn(subtle, 'decrypt').mockImplementation(async (...a: Parameters<SubtleCrypto['decrypt']>) => {
      const out = await orig(...a);
      seen.push(out);
      return out;
    });
    const wallet = await unlockWallet(PASS);
    expect(wallet.address).toBe(created.address);
    expect(seen).toHaveLength(1);
    expect(allZero(seen[0])).toBe(true);
    await expect(wallet.sign({ hash: ('0x' + '22'.repeat(32)) as `0x${string}` })).resolves.toMatch(/^0x[0-9a-f]{130}$/);
  });
});

describe('constantTimeEqual source tripwire', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '..', 'src', 'wallet', 'keystore.ts'), 'utf8');
  const start = src.indexOf('export function constantTimeEqual(');
  const body = src.slice(start, src.indexOf('\n}\n', start) + 2);

  test('the function exists and scans with an accumulator', () => {
    expect(start).toBeGreaterThan(-1);
    expect(body).toMatch(/\|=/);
  });

  test('TRIPWIRE: the comparison loop has no early exit', () => {
    const loop = body.slice(body.indexOf('for ('));
    expect(loop).not.toMatch(/return\s+false|break\s*;/);
  });
});
