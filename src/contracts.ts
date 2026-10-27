// Deployed contract addresses on Citrate testnet (chain id 40204).
//
// Reads from a vendored copy of the federation-canonical contract-address
// table at `src/generated/addresses.json` (source-of-truth: the r1006 book,
// `citrate-chain/contracts/addresses/r1006/40204.json`) and the genesis block
// hash of that network at `src/generated/network.json` (citrate-chain
// `R1006_GENESIS`). After a chain re-roll, run `npm run sync-addresses` from
// this repo root and commit the diff — no inline edit, no chance of drift
// versus the gateway / node-agent / explorer.
import type { Address } from 'viem';

import canonicalAddresses from './generated/addresses.json';
import canonicalNetwork from './generated/network.json';

/// Block-0 hash of the network the vendored book describes (r1006). r1005 and
/// r1006 share chain id 40204, so MarketplaceClient compares block 0 with this
/// before it reads the book's contracts.
export const EXPECTED_GENESIS_HASH: string = canonicalNetwork.genesisHash.toLowerCase();

/// Citrate testnet (chain id 40204).
export const CITRATE_TESTNET_CHAIN_ID = 40204 as const;

/// Canonical addresses for the testnet deployment (chain 40204), built
/// once from the vendored canonical at module load.
export const TESTNET_ADDRESSES = {
  modelRegistry: canonicalAddresses.contracts.ModelRegistry as Address,
  pricingOracle: canonicalAddresses.contracts.ComputePricingOracle as Address,
  inferenceRouter: canonicalAddresses.contracts.InferenceRouter as Address,
  computeMarketplace: canonicalAddresses.contracts.ComputeMarketplace as Address,
  bulkComputeGateway: canonicalAddresses.contracts.BulkComputeGateway as Address,
  computePoolTraining: canonicalAddresses.contracts.ComputePoolTraining as Address,
} as const;

/// Per-environment address resolver. Webapp callers should pass in
/// their own override map for non-testnet networks.
export interface MarketplaceAddresses {
  modelRegistry: Address;
  pricingOracle: Address;
  inferenceRouter: Address;
  computeMarketplace: Address;
  bulkComputeGateway: Address;
  computePoolTraining: Address;
}

/// Convenience: testnet defaults.
export function defaultAddresses(): MarketplaceAddresses {
  return { ...TESTNET_ADDRESSES };
}
