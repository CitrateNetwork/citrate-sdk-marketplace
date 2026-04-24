// MarketplaceClient tests using a hand-rolled mock PublicClient.
// Verifies the wiring: each high-level method calls the right
// contract + function with the right args and assembles the right
// shape. Live-chain integration is exercised by Rust gateway tests
// (gateway/tests/http_queries_wiring.rs) — the SDK only owns the
// translation layer.

import { describe, expect, test, vi } from 'vitest';
import type { Address, Hex, PublicClient } from 'viem';

import { MarketplaceClient } from '../src/client.js';
import { TESTNET_ADDRESSES } from '../src/contracts.js';
import { MarketplaceError } from '../src/types.js';

type ReadCall = { address: Address; functionName: string; args?: readonly unknown[] };

function mockClient(reads: Record<string, unknown> | ((c: ReadCall) => unknown)) {
  const calls: ReadCall[] = [];
  const readContract = vi.fn(async (params: ReadCall) => {
    calls.push(params);
    if (typeof reads === 'function') return reads(params);
    return reads[params.functionName];
  });
  return {
    publicClient: { readContract } as unknown as PublicClient,
    calls,
    readContract,
  };
}

const MODEL_HASH: Hex = ('0x' + 'ab'.repeat(32)) as Hex;

describe('resolveModelHash', () => {
  test('accepts a pinned 64-hex hash', () => {
    const m = mockClient({});
    const c = new MarketplaceClient({ publicClient: m.publicClient });
    expect(c.resolveModelHash(MODEL_HASH)).toBe(MODEL_HASH.toLowerCase());
  });

  test('rejects bare names', () => {
    const m = mockClient({});
    const c = new MarketplaceClient({ publicClient: m.publicClient });
    expect(() => c.resolveModelHash('llama-3.1-8b')).toThrow(MarketplaceError);
  });
});

describe('listProviders', () => {
  test('routes to InferenceRouter and filters inactive', async () => {
    const a1 = ('0x' + '11'.repeat(20)) as Address;
    const a2 = ('0x' + '22'.repeat(20)) as Address;
    const m = mockClient((call) => {
      if (call.functionName === 'getProviders') return [a1, a2];
      if (call.functionName === 'getProviderInfo') {
        const addr = (call.args?.[0] ?? '') as Address;
        if (addr === a1) return ['http://a1/infer', 100n, 0n, 5n, true];
        if (addr === a2) return ['http://a2/infer', 200n, 0n, 9n, false]; // inactive
      }
      return null;
    });
    const c = new MarketplaceClient({ publicClient: m.publicClient });
    const providers = await c.listProviders(MODEL_HASH);
    expect(providers).toHaveLength(1);
    expect(providers[0].address).toBe(a1);
    expect(providers[0].endpoint).toBe('http://a1/infer');
    expect(providers[0].stake).toBe(100n);
    // First call is getProviders, then per-address getProviderInfo.
    expect(m.calls[0].functionName).toBe('getProviders');
    expect(m.calls[0].address).toBe(TESTNET_ADDRESSES.inferenceRouter);
  });

  test('surfaces RPC failure as MarketplaceError', async () => {
    const m = mockClient((call) => {
      if (call.functionName === 'getProviders') {
        throw new Error('RPC down');
      }
      return null;
    });
    const c = new MarketplaceClient({ publicClient: m.publicClient });
    await expect(c.listProviders(MODEL_HASH)).rejects.toThrow(/chain_unavailable|RPC down/);
  });

  test('one bad provider does not sink the list', async () => {
    const a1 = ('0x' + '11'.repeat(20)) as Address;
    const a2 = ('0x' + '22'.repeat(20)) as Address;
    const m = mockClient((call) => {
      if (call.functionName === 'getProviders') return [a1, a2];
      if (call.functionName === 'getProviderInfo') {
        const addr = (call.args?.[0] ?? '') as Address;
        if (addr === a1) throw new Error('eth_call reverted');
        if (addr === a2) return ['http://a2/infer', 50n, 0n, 1n, true];
      }
      return null;
    });
    const c = new MarketplaceClient({ publicClient: m.publicClient });
    const providers = await c.listProviders(MODEL_HASH);
    expect(providers).toHaveLength(1);
    expect(providers[0].address).toBe(a2);
  });
});

describe('estimateCost', () => {
  test('forwards args to ComputePricingOracle.estimateJobCost', async () => {
    const m = mockClient({ estimateJobCost: 42n });
    const c = new MarketplaceClient({ publicClient: m.publicClient });
    const cost = await c.estimateCost({
      modelHash: MODEL_HASH,
      inputTokens: 100n,
      outputTokens: 200n,
      tier: 1,
    });
    expect(cost).toBe(42n);
    expect(m.calls[0].address).toBe(TESTNET_ADDRESSES.pricingOracle);
    expect(m.calls[0].functionName).toBe('estimateJobCost');
    expect(m.calls[0].args).toEqual([MODEL_HASH, 100n, 200n, 1]);
  });
});

describe('getProviderProfile', () => {
  test('returns null for unregistered address', async () => {
    const a = ('0x' + '99'.repeat(20)) as Address;
    const m = mockClient({
      getProvider: {
        isRegistered: false,
        stake: 0n,
        totalJobsCompleted: 0n,
        totalJobsFailed: 0n,
        reputationScore: 0n,
        currentActiveJobs: 0n,
        maxConcurrentJobs: 0n,
      },
    });
    const c = new MarketplaceClient({ publicClient: m.publicClient });
    expect(await c.getProviderProfile(a)).toBeNull();
  });

  test('returns full profile for registered address', async () => {
    const a = ('0x' + 'ab'.repeat(20)) as Address;
    const m = mockClient({
      getProvider: {
        isRegistered: true,
        stake: 1000n,
        totalJobsCompleted: 10n,
        totalJobsFailed: 1n,
        reputationScore: 9500n,
        currentActiveJobs: 2n,
        maxConcurrentJobs: 10n,
      },
    });
    const c = new MarketplaceClient({ publicClient: m.publicClient });
    const profile = await c.getProviderProfile(a);
    expect(profile).not.toBeNull();
    expect(profile!.stake).toBe(1000n);
    expect(profile!.reputationScore).toBe(9500n);
  });

  test('rejects malformed addresses', async () => {
    const m = mockClient({});
    const c = new MarketplaceClient({ publicClient: m.publicClient });
    await expect(c.getProviderProfile('not-an-address' as Address)).rejects.toThrow(MarketplaceError);
  });
});
