// MarketplaceClient — high-level, read-only-by-default client for
// browsing the marketplace. Wraps viem's PublicClient with typed
// helpers that match the SDK's hand-curated ABIs.
//
// Slice 1 scope:
//   - listProviders(modelHash): InferenceRouter.getProviders →
//                               getProviderInfo per address
//   - estimateCost(...): ComputePricingOracle.estimateJobCost
//   - getProviderProfile(addr): ComputeMarketplace.getProvider
//
// Slice 2 will add:
//   - postJob() write helper (needs WalletClient injection)
//   - watchJob(jobId): event subscription via viem's watchEvent

import { type Address, type Hex, type PublicClient, isAddress } from 'viem';

import { computeMarketplaceAbi } from './abi/compute-marketplace.js';
import { computePricingOracleAbi } from './abi/compute-pricing-oracle.js';
import { inferenceRouterAbi } from './abi/inference-router.js';
import {
  defaultAddresses,
  type MarketplaceAddresses,
} from './contracts.js';
import {
  MarketplaceError,
  type ProviderInfo,
  type ProviderProfile,
  type VerificationTierValue,
} from './types.js';

export interface MarketplaceClientOptions {
  /// viem PublicClient already configured for the target chain.
  publicClient: PublicClient;
  /// Override deployed addresses; falls back to testnet defaults.
  addresses?: MarketplaceAddresses;
}

export class MarketplaceClient {
  readonly publicClient: PublicClient;
  readonly addresses: MarketplaceAddresses;

  constructor(opts: MarketplaceClientOptions) {
    this.publicClient = opts.publicClient;
    this.addresses = opts.addresses ?? defaultAddresses();
  }

  /**
   * Resolve a model name to its on-chain `bytes32` hash.
   *
   * Slice 1: only accepts pinned hex hashes (`0x` + 64 hex chars).
   * Bare names require an off-chain index — the gateway has the same
   * v1 limitation. See `gateway/src/queries.rs::resolve_model_name`.
   */
  resolveModelHash(input: string): Hex {
    if (!/^0x[0-9a-fA-F]{64}$/.test(input)) {
      throw new MarketplaceError(
        `model name resolution requires a pinned 0x + 64 hex hash; got: ${input}`,
        'unsupported_model_name',
      );
    }
    return input.toLowerCase() as Hex;
  }

  /**
   * List active providers for a model. Returns the same shape as the
   * Rust gateway's `ChainQueries::list_providers`.
   */
  async listProviders(modelHash: Hex): Promise<ProviderInfo[]> {
    let addrs: readonly Address[];
    try {
      addrs = (await this.publicClient.readContract({
        address: this.addresses.inferenceRouter,
        abi: inferenceRouterAbi,
        functionName: 'getProviders',
        args: [modelHash],
      })) as readonly Address[];
    } catch (cause) {
      throw new MarketplaceError(
        `getProviders failed: ${(cause as Error).message ?? cause}`,
        'chain_unavailable',
        cause,
      );
    }

    const infos: ProviderInfo[] = [];
    for (const addr of addrs) {
      try {
        const tuple = (await this.publicClient.readContract({
          address: this.addresses.inferenceRouter,
          abi: inferenceRouterAbi,
          functionName: 'getProviderInfo',
          args: [addr],
        })) as readonly [string, bigint, bigint, bigint, boolean];
        const [endpoint, stake, currentLoad, totalInferences, isActive] = tuple;
        if (!isActive) continue;
        infos.push({ address: addr, endpoint, stake, currentLoad, totalInferences, isActive });
      } catch (cause) {
        // One bad provider doesn't sink the whole list — log and skip.
        // (Production may want to surface this; webapp can retry.)
        // eslint-disable-next-line no-console
        console.warn('getProviderInfo failed for', addr, cause);
      }
    }
    return infos;
  }

  /**
   * Price a job in grains (wei) via the pricing oracle. Mirrors
   * `gateway::TokenBasedPricing` semantics.
   */
  async estimateCost(args: {
    modelHash: Hex;
    inputTokens: bigint;
    outputTokens: bigint;
    tier: VerificationTierValue;
  }): Promise<bigint> {
    try {
      return (await this.publicClient.readContract({
        address: this.addresses.pricingOracle,
        abi: computePricingOracleAbi,
        functionName: 'estimateJobCost',
        args: [args.modelHash, args.inputTokens, args.outputTokens, args.tier],
      })) as bigint;
    } catch (cause) {
      throw new MarketplaceError(
        `estimateJobCost failed: ${(cause as Error).message ?? cause}`,
        'chain_unavailable',
        cause,
      );
    }
  }

  /**
   * Fetch a provider's full profile (stake + reputation + job counts).
   * Returns `null` if the provider isn't registered.
   */
  async getProviderProfile(address: Address): Promise<ProviderProfile | null> {
    if (!isAddress(address)) {
      throw new MarketplaceError(
        `invalid address: ${address}`,
        'invalid_address',
      );
    }
    try {
      const tuple = (await this.publicClient.readContract({
        address: this.addresses.computeMarketplace,
        abi: computeMarketplaceAbi,
        functionName: 'getProvider',
        args: [address],
      })) as {
        isRegistered: boolean;
        stake: bigint;
        totalJobsCompleted: bigint;
        totalJobsFailed: bigint;
        reputationScore: bigint;
        currentActiveJobs: bigint;
        maxConcurrentJobs: bigint;
      };
      if (!tuple.isRegistered) return null;
      return { address, ...tuple };
    } catch (cause) {
      throw new MarketplaceError(
        `getProvider failed: ${(cause as Error).message ?? cause}`,
        'chain_unavailable',
        cause,
      );
    }
  }
}
