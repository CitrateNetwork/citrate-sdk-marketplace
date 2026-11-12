// r1007 address book + genesis guard (file name kept from the r1006 version).
//
// r1005, r1006 and r1007 share chain id 40204, so a chain-id check cannot tell
// them apart. The vendored book is citrate-chain's root book
// `contracts/addresses/40204.json` (r1007 today); `src/generated/network.json`
// carries its block-0 hash, confirmed by `R1007_GENESIS` in citrate-chain
// core/consensus/src/hardening.rs. MarketplaceClient reads block 0 before
// it reads the book's contracts and refuses another network.

import { describe, expect, test, vi } from 'vitest';
import type { Address, PublicClient } from 'viem';

import { MarketplaceClient } from '../src/client.js';
import { EXPECTED_GENESIS_HASH, TESTNET_ADDRESSES } from '../src/contracts.js';
import * as sdk from '../src/index.js';
import canonical from '../src/generated/addresses.json';
import { MarketplaceError } from '../src/types.js';

const R1007 = '0xcf68634502b4fca1e977ac8dd35aa006bb40c04208d5cd55f1c2b508bba96631';
const R1006 = '0xa3651a272fe411948cbb4cf7cca4cee44be4248d32ab4376cea7636821c6cdd4';
const R1005 = '0x1dcfc4909dd9fdcb0f03c823d627e4b2032cc86bef5fc4561030d6c64b9775f1';
const MODEL_HASH = ('0x' + 'ab'.repeat(32)) as `0x${string}`;

describe('vendored book is the r1007 book', () => {
  test('exports the r1007 genesis hash', () => {
    expect(EXPECTED_GENESIS_HASH).toBe(R1007);
    expect((sdk as Record<string, unknown>).EXPECTED_GENESIS_HASH).toBe(R1007);
  });

  test('marketplace contracts point at r1007 block 0 (unchanged from r1006)', () => {
    expect(TESTNET_ADDRESSES.computeMarketplace.toLowerCase()).toBe('0x2fec2ac1dde3a1a749c84d487738904cd2ed50c2');
    expect(TESTNET_ADDRESSES.inferenceRouter.toLowerCase()).toBe('0x165b811cdf1edd330d3ed77b87da38e9e0c9bd0f');
    expect(TESTNET_ADDRESSES.bulkComputeGateway.toLowerCase()).toBe('0x37a9dec7ea9b7e7ef6fd9d094540d22933ddd8d0');
    expect(canonical.aaStack.CitrateWalletFactory.toLowerCase()).toBe('0x6ee3b59099c9c812cdf1c9e7e6ff166b2558434c');
  });

  test('drops contracts retired at r1006, carries the r1007 post-genesis contracts, leaks no r1005 or r1006 post-genesis address', () => {
    // The vendored book is the root book, which folds r1007's post-genesis contracts in.
    const names = Object.keys(canonical.contracts);
    for (const gone of ['LiquidStakingPool', 'CitAgentTimelock']) {
      expect(names).not.toContain(gone);
    }
    const contracts = canonical.contracts as Record<string, string>;
    expect(contracts.DefensePrimeComplianceRegistry).toBe('0xabfe0c9d358ce8af37dc4d50aa4eaebdb250c914');
    // r1007 POSTGENESIS_DEPLOYER nonce 0 (citrate-chain contracts/addresses/r1007/40204.provenance.json)
    expect(contracts.TenantHierarchy).toBe('0x92f2bc7e1b33841de1b138fe28cf202222562cc3');
    const blob = JSON.stringify(canonical).toLowerCase();
    // r1005 addresses that moved at r1006, and r1006 post-genesis addresses that moved at r1007
    for (const dead of ['0x9ac05ad6', '0x804a8021', '0xf8ad11f6', '0x73270e98', '0xa96a891b', '0x42ae16da',
      '0xe1c16749', '0xb0772491', '0x82224833', '0xf2359912', '0x5924d1d3']) {
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
  test('r1006 node: wrong_network naming both hashes, no contract read', async () => {
    const m = chain(R1006);
    const c = new MarketplaceClient({ publicClient: m.publicClient });
    const err = await estimate(c).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MarketplaceError);
    expect((err as MarketplaceError).code).toBe('wrong_network');
    expect((err as Error).message).toContain(R1006);
    expect((err as Error).message).toContain(R1007);
    expect(m.readContract).not.toHaveBeenCalled();
  });

  test.each([
    ['listProviders', (c: MarketplaceClient) => c.listProviders(MODEL_HASH)],
    ['getCreditBalance', (c: MarketplaceClient) => c.getCreditBalance(('0x' + '11'.repeat(20)) as Address)],
    ['fetchCreditsLogs', (c: MarketplaceClient) => c.fetchCreditsLogs(('0x' + '11'.repeat(20)) as Address, 0n, 'latest')],
    ['minPurchaseUsd', (c: MarketplaceClient) => c.minPurchaseUsd()],
    ['getProviderProfile', (c: MarketplaceClient) => c.getProviderProfile(('0x' + '11'.repeat(20)) as Address)],
  ])('%s refuses an r1005 node', async (_name, call) => {
    const m = chain(R1006);
    const c = new MarketplaceClient({ publicClient: m.publicClient });
    await expect(call(c)).rejects.toMatchObject({ code: 'wrong_network' });
    expect(m.readContract).not.toHaveBeenCalled();
  });

  test('r1007 node: reads go through and block 0 is read once', async () => {
    const m = chain(R1007.toUpperCase().replace('0X', '0x'));
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
    const m = chain(R1006);
    const c = new MarketplaceClient({ publicClient: m.publicClient });
    await expect(estimate(c)).rejects.toMatchObject({ code: 'wrong_network' });
    await expect(estimate(c)).rejects.toMatchObject({ code: 'wrong_network' });
    expect(m.getBlock).toHaveBeenCalledTimes(2);
  });

  test('caller-supplied addresses skip the check unless a genesis is given; null opts out', async () => {
    const own = { ...TESTNET_ADDRESSES };
    const m1 = chain(R1006);
    await expect(estimate(new MarketplaceClient({ publicClient: m1.publicClient, addresses: own }))).resolves.toBe(7n);
    expect(m1.getBlock).not.toHaveBeenCalled();
    const m2 = chain(R1006);
    await expect(
      estimate(new MarketplaceClient({ publicClient: m2.publicClient, addresses: own, expectedGenesisHash: R1007 })),
    ).rejects.toMatchObject({ code: 'wrong_network' });
    const m3 = chain(R1006);
    await expect(estimate(new MarketplaceClient({ publicClient: m3.publicClient, expectedGenesisHash: null }))).resolves.toBe(7n);
  });

  test('rejects a malformed expectedGenesisHash', () => {
    const m = chain(R1007);
    expect(() => new MarketplaceClient({ publicClient: m.publicClient, expectedGenesisHash: '0x12' })).toThrow(/expectedGenesisHash/);
  });
});
