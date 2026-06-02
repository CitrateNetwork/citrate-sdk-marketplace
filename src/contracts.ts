// Deployed contract addresses on Citrate testnet (chain id 40204).
// Mirror of `gateway/src/config.rs::ContractAddresses::default()`. If
// you change one here, change the Rust default too — they MUST match.
import type { Address } from 'viem';

/// Citrate testnet (chain id 40204).
export const CITRATE_TESTNET_CHAIN_ID = 40204 as const;

/// Canonical addresses for the testnet deployment (chain 40204).
/// Source of truth: citrate-chain contracts/DEPLOYED_ADDRESSES.md.
export const TESTNET_ADDRESSES = {
  modelRegistry: '0x077fbc3338a9e6bad90a3a041e6b7425689754ef' as Address,
  // FIX: this previously pointed at 0x46773…d40b5, which is the
  // HeartbeatMonitor, not the pricing oracle. ComputePricingOracle is
  // 0xa1eed6…f4647 per DEPLOYED_ADDRESSES.md. The gateway's Rust
  // config.rs default carries the same stale value and must be fixed too.
  pricingOracle: '0xa1eed6ae021504e2a1e310e6c0f7c1a0c5bf4647' as Address,
  inferenceRouter: '0xad7c3135c1b9b3189208fd617b6b058c1c0469f3' as Address,
  // Now deployed on chain 40204 (were zero-address placeholders while
  // staged). Per DEPLOYED_ADDRESSES.md.
  computeMarketplace: '0xf3f9f72ea2bb3f763b07390b7257da643b8ee9b6' as Address,
  bulkComputeGateway: '0x7efc1eb17beff413e1af7fb3bb541e895c307300' as Address,
  computePoolTraining: '0xf1eae5dd4a1639922ea610142f7ce51330065b57' as Address,
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
