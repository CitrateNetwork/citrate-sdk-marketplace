// SECREM-02 5.3 — CITRATE_SDK_MARKETPLACE-2026-05-31-005.
//
// The keystore MAC check used a JS string `!==` comparison, which
// short-circuits on the first differing character (timing
// side-channel). decryptKeystore must compare MACs in constant time.
//
// Constant-time-ness itself isn't reliably measurable in a unit
// test, so this file locks the fix three ways:
//   1. unit tests for the exported `constantTimeEqual` primitive,
//   2. a source tripwire: keystore.ts must not string-compare the mac,
//   3. behavior: wrong passphrase / corrupted mac still fail closed.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

import {
  constantTimeEqual,
  decryptKeystore,
  encryptKeystore,
} from '../src/wallet/keystore.js';

const TEST_KEY = new Uint8Array(32).map((_, i) => (i * 7 + 3) & 0xff);
const PASSPHRASE = 'correct-horse-battery-staple';

describe('constantTimeEqual primitive (-005)', () => {
  test('equal byte arrays compare equal', () => {
    const a = new Uint8Array([1, 2, 3, 255, 0]);
    const b = new Uint8Array([1, 2, 3, 255, 0]);
    expect(constantTimeEqual(a, b)).toBe(true);
  });

  test('first-byte difference compares unequal', () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([9, 2, 3]);
    expect(constantTimeEqual(a, b)).toBe(false);
  });

  test('last-byte difference compares unequal', () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([1, 2, 9]);
    expect(constantTimeEqual(a, b)).toBe(false);
  });

  test('length mismatch compares unequal', () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([1, 2]);
    expect(constantTimeEqual(a, b)).toBe(false);
  });

  test('empty arrays compare equal', () => {
    expect(constantTimeEqual(new Uint8Array(0), new Uint8Array(0))).toBe(true);
  });
});

describe('keystore MAC comparison source tripwire (-005)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(
    join(here, '..', 'src', 'wallet', 'keystore.ts'),
    'utf8',
  );

  test('TRIPWIRE: decryptKeystore does not string-compare the mac', () => {
    // The vulnerable line was:
    //   if (bytesToPlainHex(mac) !== ks.crypto.mac.toLowerCase()) {
    expect(src).not.toMatch(/bytesToPlainHex\(mac\)\s*!==/);
  });

  test('TRIPWIRE: decryptKeystore routes the mac check through constantTimeEqual', () => {
    expect(src).toMatch(/constantTimeEqual\(/);
  });
});

describe('keystore MAC behavior is unchanged (fail closed)', () => {
  test('round-trip with the right passphrase still works', async () => {
    const ks = await encryptKeystore(TEST_KEY, PASSPHRASE, '0xdeadbeef');
    const out = await decryptKeystore(ks, PASSPHRASE);
    expect(Array.from(out)).toEqual(Array.from(TEST_KEY));
  });

  test('wrong passphrase still throws invalid passphrase', async () => {
    const ks = await encryptKeystore(TEST_KEY, PASSPHRASE, '0xdeadbeef');
    await expect(decryptKeystore(ks, 'wrong-passphrase')).rejects.toThrow(
      /invalid passphrase/,
    );
  });

  test('corrupted (truncated) mac still throws invalid passphrase', async () => {
    const ks = await encryptKeystore(TEST_KEY, PASSPHRASE, '0xdeadbeef');
    ks.crypto.mac = ks.crypto.mac.slice(0, 32);
    await expect(decryptKeystore(ks, PASSPHRASE)).rejects.toThrow(
      /invalid passphrase/,
    );
  });

  test('non-hex mac still throws invalid passphrase (never crashes differently)', async () => {
    const ks = await encryptKeystore(TEST_KEY, PASSPHRASE, '0xdeadbeef');
    ks.crypto.mac = 'zz'.repeat(32);
    await expect(decryptKeystore(ks, PASSPHRASE)).rejects.toThrow(
      /invalid passphrase/,
    );
  });
});
