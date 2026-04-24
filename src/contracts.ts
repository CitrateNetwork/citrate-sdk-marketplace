// Deployed contract addresses on Citrate testnet (chain id 40204).
// Mirror of `gateway/src/config.rs::ContractAddresses::default()`. If
// you change one here, change the Rust default too — they MUST match.
import type { Address } from 'viem';

/// Citrate testnet (chain id 40204).
export const CITRATE_TESTNET_CHAIN_ID = 40204 as const;

/// Canonical addresses for the testnet deployment.
export const TESTNET_ADDRESSES = {
  modelRegistry: '0x077fbc3338a9e6bad90a3a041e6b7425689754ef' as Address,
  pricingOracle: '0x46773aeca885be65cd313b7d9bce9625767d40b5' as Address,
  inferenceRouter: '0xad7c3135c1b9b3189208fd617b6b058c1c0469f3' as Address,
  // ComputeMarketplace not yet deployed to testnet at the time of
  // this slice — buyer-webapp Flow B reads will resolve via env
  // override until the address lands.
  computeMarketplace: '0x0000000000000000000000000000000000000000' as Address,
} as const;

/// Per-environment address resolver. Webapp callers should pass in
/// their own override map for non-testnet networks.
export interface MarketplaceAddresses {
  modelRegistry: Address;
  pricingOracle: Address;
  inferenceRouter: Address;
  computeMarketplace: Address;
}

/// Convenience: testnet defaults.
export function defaultAddresses(): MarketplaceAddresses {
  return { ...TESTNET_ADDRESSES };
}
