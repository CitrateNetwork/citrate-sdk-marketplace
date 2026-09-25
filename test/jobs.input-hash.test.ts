// Cross-lane variant of PBA-L6b-021 (SERVICES lane). citrate-node-agent now
// declines to bid on a job whose on-chain inputHash is not the 32-byte keccak256
// of the job input. postJobCalldata used to pass any Hex through as inputHash
// ("e.g. an IPFS CID encoded as bytes"), so jobs posted that way silently got
// no bids. It now derives keccak256(input) from raw bytes, and accepts a Hex
// only when it is a 32-byte digest; anything else (a CID, a short or long
// pre-hash) is refused with an error that says why.
import { describe, expect, test } from 'vitest';
import { keccak256, stringToBytes, toHex, type Hex } from 'viem';

import { postJobCalldata, TIER } from '../src/jobs.js';

const base = {
  modelHash: ('0x' + 'ab'.repeat(32)) as Hex,
  maxPriceGrains: 1n,
  tier: TIER.Commitment,
  bidWindowBlocks: 1n,
  execWindowBlocks: 1n,
};

describe('PBA-L6b-021 variant: postJob inputHash is keccak256(input)', () => {
  test('raw input bytes are hashed with keccak256', () => {
    const input = stringToBytes('{"prompt":"hi"}');
    expect(postJobCalldata({ ...base, input }).inputHash).toBe(keccak256(input));
  });

  test('a precomputed 32-byte digest is accepted as-is', () => {
    const digest = keccak256(stringToBytes('x'));
    expect(postJobCalldata({ ...base, input: digest }).inputHash).toBe(digest);
  });

  test.each([
    ['CID bytes', toHex(stringToBytes('bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'))],
    ['one byte', '0xab'],
    ['31 bytes', ('0x' + '11'.repeat(31))],
    ['33 bytes', ('0x' + '11'.repeat(33))],
    ['empty', '0x'],
  ])('refuses a Hex that is not a 32-byte digest (%s)', (_label, bad) => {
    expect(() => postJobCalldata({ ...base, input: bad as Hex })).toThrow(/32-byte keccak256/);
  });
});
