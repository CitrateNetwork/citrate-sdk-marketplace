// Tests for the Flow B helpers.

import { describe, expect, test } from 'vitest';
import { keccak256, slice, type Hex, type Log } from 'viem';

import {
  parseJobEvents,
  postJobCalldata,
  TIER,
} from '../src/jobs.js';
import { PaymentMethod } from '../src/types.js';
import { computeMarketplaceAbi } from '../src/abi/compute-marketplace.js';
import { encodeAbiParameters } from 'viem';

const MODEL_HASH = ('0x' + 'ab'.repeat(32)) as Hex;
const ONE_SALT = 10n ** 18n;
// The ComputeMarketplace address the fixture logs are emitted from. SMK-B-006:
// parseJobEvents drops any log whose emitter differs.
const JOBS_EMITTER = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as `0x${string}`;

describe('postJobCalldata', () => {
  test('hashes raw input bytes with keccak256', () => {
    const input = new TextEncoder().encode('hello world');
    const { data, inputHash } = postJobCalldata({
      modelHash: MODEL_HASH,
      input,
      maxPriceGrains: ONE_SALT,
      tier: TIER.Commitment,
      bidWindowBlocks: 100n,
      execWindowBlocks: 200n,
    });
    expect(inputHash).toBe(keccak256(input));
    // Calldata starts with the postJob selector
    expect(data.length).toBeGreaterThan(10);
    expect(data.startsWith('0x')).toBe(true);
  });

  test('passes through pre-hashed Hex input unchanged', () => {
    const preHashed = ('0x' + 'cd'.repeat(32)) as Hex;
    const { inputHash } = postJobCalldata({
      modelHash: MODEL_HASH,
      input: preHashed,
      maxPriceGrains: ONE_SALT,
      tier: TIER.ZKProof,
      bidWindowBlocks: 1n,
      execWindowBlocks: 1n,
    });
    expect(inputHash).toBe(preHashed);
  });

  test('selector is the first 4 bytes of keccak256(signature)', () => {
    const { data } = postJobCalldata({
      modelHash: MODEL_HASH,
      input: new Uint8Array([0xab]),
      maxPriceGrains: 1n,
      tier: TIER.Commitment,
      bidWindowBlocks: 1n,
      execWindowBlocks: 1n,
    });
    // The selector for `postJob(bytes32,bytes,uint256,uint8,uint256,uint256)`
    const sigHash = keccak256(
      new TextEncoder().encode(
        'postJob(bytes32,bytes,uint256,uint8,uint256,uint256)',
      ),
    );
    const expectedSelector = slice(sigHash, 0, 4);
    expect(slice(data, 0, 4)).toBe(expectedSelector);
  });

  test('paymentMethod=BulkCredits routes to postJobWithMethod selector', () => {
    const { data: saltData } = postJobCalldata({
      modelHash: MODEL_HASH,
      input: ('0x' + 'ab'.repeat(32)) as Hex, // a 32-byte digest (PBA-L6b-021)
      maxPriceGrains: 1n,
      tier: TIER.Commitment,
      bidWindowBlocks: 1n,
      execWindowBlocks: 1n,
      paymentMethod: PaymentMethod.SALT,
    });
    const { data: creditsData } = postJobCalldata({
      modelHash: MODEL_HASH,
      input: ('0x' + 'ab'.repeat(32)) as Hex, // a 32-byte digest (PBA-L6b-021)
      maxPriceGrains: 1n,
      tier: TIER.Commitment,
      bidWindowBlocks: 1n,
      execWindowBlocks: 1n,
      paymentMethod: PaymentMethod.BulkCredits,
    });
    // Different selectors → different first 4 bytes.
    expect(saltData.slice(0, 10)).not.toBe(creditsData.slice(0, 10));
  });

  test('paymentMethod omitted defaults to SALT (postJob selector)', () => {
    const { data: defaulted } = postJobCalldata({
      modelHash: MODEL_HASH,
      input: ('0x' + 'ab'.repeat(32)) as Hex, // a 32-byte digest (PBA-L6b-021)
      maxPriceGrains: 1n,
      tier: TIER.Commitment,
      bidWindowBlocks: 1n,
      execWindowBlocks: 1n,
    });
    const { data: explicit } = postJobCalldata({
      modelHash: MODEL_HASH,
      input: ('0x' + 'ab'.repeat(32)) as Hex, // a 32-byte digest (PBA-L6b-021)
      maxPriceGrains: 1n,
      tier: TIER.Commitment,
      bidWindowBlocks: 1n,
      execWindowBlocks: 1n,
      paymentMethod: PaymentMethod.SALT,
    });
    expect(defaulted).toBe(explicit);
  });

  test('PaymentMethod constants match the on-chain enum positions', () => {
    expect(PaymentMethod.SALT).toBe(0);
    expect(PaymentMethod.BulkCredits).toBe(1);
  });

  test('TIER constants match the on-chain enum positions', () => {
    expect(TIER.Commitment).toBe(0);
    expect(TIER.ZKProof).toBe(1);
    expect(TIER.TEE).toBe(2);
  });

  test('rejects malformed Hex input', () => {
    expect(() =>
      postJobCalldata({
        modelHash: MODEL_HASH,
        input: '0xZZZ' as Hex,
        maxPriceGrains: 1n,
        tier: TIER.Commitment,
        bidWindowBlocks: 1n,
        execWindowBlocks: 1n,
      }),
    ).toThrow();
  });
});

describe('parseJobEvents', () => {
  // Build a mock log for ComputeMarketplace events using viem encoding.
  function jobPostedLog(
    jobId: bigint,
    requester: Hex,
    modelHash: Hex,
  ): Log {
    // Selectors for indexed parameters use keccak256 of the signature
    // and topics[0] is the event signature hash. Easier path:
    // round-trip via decodeEventLog by constructing topics manually.
    const sigHash = keccak256(
      new TextEncoder().encode('JobPosted(uint256,address,bytes32)'),
    );
    return {
      address: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as Hex,
      blockNumber: 100n,
      blockHash: ('0x' + '00'.repeat(32)) as Hex,
      data: '0x' as Hex,
      logIndex: 0,
      removed: false,
      transactionHash: ('0x' + '11'.repeat(32)) as Hex,
      transactionIndex: 0,
      topics: [
        sigHash,
        encodeAbiParameters([{ type: 'uint256' }], [jobId]) as Hex,
        encodeAbiParameters([{ type: 'address' }], [requester]) as Hex,
        modelHash,
      ],
    } as Log;
  }

  test('decodes JobPosted', () => {
    const log = jobPostedLog(
      42n,
      '0x' + 'a1'.repeat(20) as Hex,
      MODEL_HASH,
    );
    const events = parseJobEvents([log], JOBS_EMITTER);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('JobPosted');
    if (events[0].kind === 'JobPosted') {
      expect(events[0].jobId).toBe(42n);
      expect(events[0].requester.toLowerCase()).toBe('0x' + 'a1'.repeat(20));
      expect(events[0].modelHash).toBe(MODEL_HASH);
      expect(events[0].blockNumber).toBe(100n);
    }
  });

  test('skips logs that don’t match a known signature', () => {
    const noiseLog = {
      address: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as Hex,
      blockNumber: 1n,
      blockHash: ('0x' + '00'.repeat(32)) as Hex,
      data: '0x' as Hex,
      logIndex: 0,
      removed: false,
      transactionHash: ('0x' + '11'.repeat(32)) as Hex,
      transactionIndex: 0,
      topics: [('0x' + 'ff'.repeat(32)) as Hex],
    } as Log;
    expect(parseJobEvents([noiseLog], JOBS_EMITTER)).toEqual([]);
  });

  // Make TS happy when `computeMarketplaceAbi` is unused at runtime.
  test('abi import is reachable', () => {
    expect(computeMarketplaceAbi.length).toBeGreaterThan(0);
  });
});
