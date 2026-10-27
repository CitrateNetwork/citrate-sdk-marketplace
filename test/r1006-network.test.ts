// r1006 address book + genesis guard.
//
// r1005 and r1006 share chain id 40204, so a chain-id check cannot tell
// them apart. The vendored book is citrate-chain
// `contracts/addresses/r1006/40204.json`; `src/generated/network.json`
// carries the r1006 block-0 hash (`R1006_GENESIS` in citrate-chain
// core/consensus/src/hardening.rs). MarketplaceClient reads block 0 before
// it reads the book's contracts and refuses another network.

import { describe, expect, test, vi } from 'vitest';
import type { Address, PublicClient } from 'viem';

import { MarketplaceClient } from '../src/client.js';
import { EXPECTED_GENESIS_HASH, TESTNET_ADDRESSES } from '../src/contracts.js';
import * as sdk from '../src/index.js';
import canonical from '../src/generated/addresses.json';
import { MarketplaceError } from '../src/types.js';

const R1006 = '0xa3651a272fe411948cbb4cf7cca4cee44be4248d32ab4376cea7636821c6cdd4';
const R1005 = '0x1dcfc4909dd9fdcb0f03c823d627e4b2032cc86bef5fc4561030d6c64b9775f1';
const MODEL_HASH = ('0x' + 'ab'.repeat(32)) as `0x${string}`;

describe('vendored book is the r1006 book', () => {
  test('exports the r1006 genesis hash', () => {
    expect(EXPECTED_GENESIS_HASH).toBe(R1006);
    expect((sdk as Record<string, unknown>).EXPECTED_GENESIS_HASH).toBe(R1006);
  });

  test('marketplace contracts point at r1006 block 0', () => {
    expect(TESTNET_ADDRESSES.computeMarketplace.toLowerCase()).toBe('0x2fec2ac1dde3a1a749c84d487738904cd2ed50c2');
    expect(TESTNET_ADDRESSES.inferenceRouter.toLowerCase()).toBe('0x165b811cdf1edd330d3ed77b87da38e9e0c9bd0f');
    expect(TESTNET_ADDRESSES.bulkComputeGateway.toLowerCase()).toBe('0x37a9dec7ea9b7e7ef6fd9d094540d22933ddd8d0');
    expect(canonical.aaStack.CitrateWalletFactory.toLowerCase()).toBe('0x6ee3b59099c9c812cdf1c9e7e6ff166b2558434c');
  });

  test('drops contracts not in r1006 block 0 and leaks no r1005 address', () => {
    const names = Object.keys(canonical.contracts);
    for (const gone of ['LiquidStakingPool', 'CitAgentTimelock', 'DefensePrimeComplianceRegistry', 'TenantHierarchy']) {
      expect(names).not.toContain(gone);
    }
    const blob = JSON.stringify(canonical).toLowerCase();
    for (const dead of ['0x9ac05ad6', '0x804a8021', '0xf8ad11f6', '0x73270e98', '0xa96a891b', '0x42ae16da']) {
      expect(blob).not.toContain(dead);
    }
  });
});

function chain(genesis: string | null | 'throw') {
  const getBlock = vi.fn(async () => {
    if (genesis === 'throw') throw new Error('RPC down');
    return genesis === null ? null : { hash: genesis, number: 0n };
  });
  const readContract = vi.fn(async () => 7n);
  return { publicClient: { getBlock, readContract } as unknown as PublicClient, getBlock, readContract };
}

const estimate = (c: MarketplaceClient) =>
  c.estimateCost({ modelHash: MODEL_HASH, inputTokens: 1n, outputTokens: 1n, tier: 0 });

describe('MarketplaceClient refuses an RPC on another genesis', () => {
  test('r1005 node: wrong_network naming both hashes, no contract read', async () => {
    const m = chain(R1005);
    const c = new MarketplaceClient({ publicClient: m.publicClient });
    const err = await estimate(c).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MarketplaceError);
    expect((err as MarketplaceError).code).toBe('wrong_network');
    expect((err as Error).message).toContain(R1005);
    expect((err as Error).message).toContain(R1006);
    expect(m.readContract).not.toHaveBeenCalled();
  });

  test.each([
    ['listProviders', (c: MarketplaceClient) => c.listProviders(MODEL_HASH)],
    ['getCreditBalance', (c: MarketplaceClient) => c.getCreditBalance(('0x' + '11'.repeat(20)) as Address)],
    ['fetchCreditsLogs', (c: MarketplaceClient) => c.fetchCreditsLogs(('0x' + '11'.repeat(20)) as Address, 0n, 'latest')],
    ['minPurchaseUsd', (c: MarketplaceClient) => c.minPurchaseUsd()],
    ['getProviderProfile', (c: MarketplaceClient) => c.getProviderProfile(('0x' + '11'.repeat(20)) as Address)],
  ])('%s refuses an r1005 node', async (_name, call) => {
    const m = chain(R1005);
    const c = new MarketplaceClient({ publicClient: m.publicClient });
    await expect(call(c)).rejects.toMatchObject({ code: 'wrong_network' });
    expect(m.readContract).not.toHaveBeenCalled();
  });

  test('r1006 node: reads go through and block 0 is read once', async () => {
    const m = chain(R1006.toUpperCase().replace('0X', '0x'));
    const c = new MarketplaceClient({ publicClient: m.publicClient });
    await expect(estimate(c)).resolves.toBe(7n);
    await expect(estimate(c)).resolves.toBe(7n);
    expect(m.getBlock).toHaveBeenCalledTimes(1);
  });

  test.each([[null], ['throw']] as const)('fails closed when block 0 is %s', async (g) => {
    const m = chain(g);
    const c = new MarketplaceClient({ publicClient: m.publicClient });
    await expect(estimate(c)).rejects.toMatchObject({ code: 'wrong_network' });
  });

  test('a failed check is not cached as success', async () => {
    const m = chain(R1005);
    const c = new MarketplaceClient({ publicClient: m.publicClient });
    await expect(estimate(c)).rejects.toMatchObject({ code: 'wrong_network' });
    await expect(estimate(c)).rejects.toMatchObject({ code: 'wrong_network' });
    expect(m.getBlock).toHaveBeenCalledTimes(2);
  });

  test('caller-supplied addresses skip the check unless a genesis is given; null opts out', async () => {
    const own = { ...TESTNET_ADDRESSES };
    const m1 = chain(R1005);
    await expect(estimate(new MarketplaceClient({ publicClient: m1.publicClient, addresses: own }))).resolves.toBe(7n);
    expect(m1.getBlock).not.toHaveBeenCalled();
    const m2 = chain(R1005);
    await expect(
      estimate(new MarketplaceClient({ publicClient: m2.publicClient, addresses: own, expectedGenesisHash: R1006 })),
    ).rejects.toMatchObject({ code: 'wrong_network' });
    const m3 = chain(R1005);
    await expect(estimate(new MarketplaceClient({ publicClient: m3.publicClient, expectedGenesisHash: null }))).resolves.toBe(7n);
  });

  test('rejects a malformed expectedGenesisHash', () => {
    const m = chain(R1006);
    expect(() => new MarketplaceClient({ publicClient: m.publicClient, expectedGenesisHash: '0x12' })).toThrow(/expectedGenesisHash/);
  });
});
