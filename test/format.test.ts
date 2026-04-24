// Mirrors the goldens from
// `wallet-core/src/format.rs::tests::grains_to_salt_*` so the SDK
// renders SALT amounts identically to the Rust gateway / GUI.

import { describe, expect, test } from 'vitest';

import { grainsToSalt, grainsToSaltDisplay } from '../src/format.js';

const ONE_SALT = 10n ** 18n;

describe('grainsToSalt', () => {
  test('zero', () => {
    expect(grainsToSalt(0n)).toBe('0');
  });

  test('1 SALT', () => {
    expect(grainsToSalt(ONE_SALT)).toBe('1');
  });

  test('1.5 SALT', () => {
    expect(grainsToSalt(ONE_SALT + ONE_SALT / 2n)).toBe('1.5');
  });

  test('0.0005 SALT', () => {
    expect(grainsToSalt(500_000_000_000_000n)).toBe('0.0005');
  });

  test('full 18 fractional digits', () => {
    expect(grainsToSalt(123_456_789_012_345_678n)).toBe('0.123456789012345678');
  });

  test('negative grains preserved', () => {
    expect(grainsToSalt(-ONE_SALT)).toBe('-1');
  });
});

describe('grainsToSaltDisplay', () => {
  test('appends SALT suffix', () => {
    expect(grainsToSaltDisplay(ONE_SALT)).toBe('1 SALT');
  });

  test('comma-separates large whole part', () => {
    expect(grainsToSaltDisplay(1_234_567n * ONE_SALT)).toBe('1,234,567 SALT');
  });

  test('handles fractional + commas together', () => {
    expect(grainsToSaltDisplay(1_234n * ONE_SALT + ONE_SALT / 2n)).toBe(
      '1,234.5 SALT',
    );
  });

  test('zero renders as "0 SALT"', () => {
    expect(grainsToSaltDisplay(0n)).toBe('0 SALT');
  });
});
