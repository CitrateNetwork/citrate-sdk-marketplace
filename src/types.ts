// Marketplace value types. These mirror the Solidity structs and the
// Rust `ProviderInfo` in citrate-inference-gateway. Keep in sync.

import type { Address } from 'viem';

/// Provider entry returned by the InferenceRouter.
///
/// Mirrors the 5-tuple from `InferenceRouter.getProviderInfo(address)`:
///   (string endpoint, uint256 stake, uint256 currentLoad,
///    uint256 totalInferences, bool isActive)
export interface ProviderInfo {
  /// EOA address of the provider.
  address: Address;
  /// HTTPS endpoint the gateway posts inference requests to.
  endpoint: string;
  /// Provider's bonded stake in grains (wei).
  stake: bigint;
  /// Currently in-flight inference count.
  currentLoad: bigint;
  /// Lifetime completed inferences.
  totalInferences: bigint;
  /// `false` filters the provider out of dispatch selection.
  isActive: boolean;
}

/// Full ProviderProfile from `ComputeMarketplace.getProvider(address)`.
/// Used by the buyer webapp's provider detail view.
export interface ProviderProfile {
  address: Address;
  isRegistered: boolean;
  stake: bigint;
  totalJobsCompleted: bigint;
  totalJobsFailed: bigint;
  /// Basis points (10000 = 100%).
  reputationScore: bigint;
  currentActiveJobs: bigint;
  maxConcurrentJobs: bigint;
}

/// Payment method for `ComputeMarketplace.postJobWithMethod`
/// (CM-06 WP-06.1).
///
///   SALT       : caller sends msg.value = maxPrice in SALT
///   BulkCredits: caller has a credit balance in BulkComputeGateway;
///                the marketplace debits the SALT-equivalent amount
///                of credits at post time. msg.value MUST be 0.
export const PaymentMethod = {
  SALT: 0,
  BulkCredits: 1,
} as const;
export type PaymentMethodValue =
  (typeof PaymentMethod)[keyof typeof PaymentMethod];

/// Verification tier — passed to `ComputePricingOracle.estimateJobCost`
/// and to `ComputeMarketplace.postJob`.
export const VerificationTier = {
  /// 1.0× multiplier. Provider commitment only; cheapest.
  Commitment: 0,
  /// 1.5× multiplier. ZK proof of correct execution.
  ZKProof: 1,
  /// 2.0× multiplier. Trusted execution environment attestation.
  TEE: 2,
} as const;
export type VerificationTierValue =
  (typeof VerificationTier)[keyof typeof VerificationTier];

/// SDK-wide error surface. All thrown errors derive from this so
/// consumers can `catch (e: MarketplaceError)` without losing detail.
export class MarketplaceError extends Error {
  constructor(
    message: string,
    /// Machine-readable code: 'chain_unavailable', 'unknown_provider',
    /// 'invalid_response', etc.
    public readonly code: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'MarketplaceError';
  }
}
