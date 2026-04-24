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

import { type Address, type Hex, type Log, type PublicClient, isAddress } from 'viem';

const purchasedEvent = {
  type: 'event',
  name: 'CreditsPurchased',
  inputs: [
    { name: 'institution', type: 'address', indexed: true },
    { name: 'stablecoin', type: 'address', indexed: true },
    { name: 'usdAmount', type: 'uint256', indexed: false },
    { name: 'creditsReceived', type: 'uint256', indexed: false },
    { name: 'purchaseIndex', type: 'uint256', indexed: false },
  ],
} as const;

const spentEvent = {
  type: 'event',
  name: 'CreditsSpent',
  inputs: [
    { name: 'institution', type: 'address', indexed: true },
    { name: 'spender', type: 'address', indexed: true },
    { name: 'creditAmount', type: 'uint256', indexed: false },
  ],
} as const;

import { bulkComputeGatewayAbi } from './abi/bulk-compute-gateway.js';
import { computeMarketplaceAbi } from './abi/compute-marketplace.js';
import { computePricingOracleAbi } from './abi/compute-pricing-oracle.js';
import { erc20Abi } from './abi/erc20.js';
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
   * Read an institution's credit balance from BulkComputeGateway
   * (CM-06 WP-06.3). Returns the raw PFLOP-hour count (18 decimals).
   *
   * Returns `0n` when `bulkComputeGateway` is the zero address — the
   * webapp uses this to render an "address not configured" hint
   * without throwing.
   */
  async getCreditBalance(institution: Address): Promise<bigint> {
    if (this.addresses.bulkComputeGateway === '0x0000000000000000000000000000000000000000') {
      return 0n;
    }
    if (!isAddress(institution)) {
      throw new MarketplaceError(
        `invalid institution: ${institution}`,
        'invalid_address',
      );
    }
    try {
      return (await this.publicClient.readContract({
        address: this.addresses.bulkComputeGateway,
        abi: bulkComputeGatewayAbi,
        functionName: 'getCreditBalance',
        args: [institution],
      })) as bigint;
    } catch (cause) {
      throw new MarketplaceError(
        `getCreditBalance failed: ${(cause as Error).message ?? cause}`,
        'chain_unavailable',
        cause,
      );
    }
  }

  /**
   * Fetch CreditsPurchased + CreditsSpent logs for an institution
   * between two blocks. Used by the /credits history table. The
   * caller parses the raw logs through parseCreditsEvents() — we
   * return Log[] here (not typed events) so the UI can merge the
   * results with a polling loop that tracks seen txHashes without
   * re-decoding.
   *
   * Returns an empty array when bulkComputeGateway is the zero
   * sentinel — no pre-deployment RPC thrash.
   */
  async fetchCreditsLogs(
    institution: Address,
    fromBlock: bigint | 'earliest',
    toBlock: bigint | 'latest',
  ): Promise<Log[]> {
    if (this.addresses.bulkComputeGateway === '0x0000000000000000000000000000000000000000') {
      return [];
    }
    const gateway = this.addresses.bulkComputeGateway;
    // Two separate getLogs calls because the event signatures differ
    // — viem doesn't batch filters for distinct event ABIs. We merge
    // client-side. Errors on either fan out through a Promise.all
    // so one failing filter fails the whole fetch (callers retry).
    const [purchasedLogs, spentLogs] = await Promise.all([
      this.publicClient.getLogs({
        address: gateway,
        event: purchasedEvent,
        args: { institution },
        fromBlock,
        toBlock,
      }),
      this.publicClient.getLogs({
        address: gateway,
        event: spentEvent,
        args: { institution },
        fromBlock,
        toBlock,
      }),
    ]);
    return [...purchasedLogs, ...spentLogs] as Log[];
  }

  /**
   * Read ERC20.allowance(owner, spender) for the credits buy flow.
   * The webapp uses this to skip the approve step when the existing
   * allowance already covers the requested amount. Returns 0n on
   * any read failure (conservative — callers then prompt approve).
   */
  async erc20Allowance(
    token: Address,
    owner: Address,
    spender: Address,
  ): Promise<bigint> {
    try {
      return (await this.publicClient.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [owner, spender],
      })) as bigint;
    } catch {
      return 0n;
    }
  }

  /**
   * Read ERC20.balanceOf(account) for the connected buyer. Used by
   * the buy-credits form to render "insufficient USDC" ahead of the
   * on-chain revert. Returns 0n on failure.
   */
  async erc20BalanceOf(token: Address, account: Address): Promise<bigint> {
    try {
      return (await this.publicClient.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [account],
      })) as bigint;
    } catch {
      return 0n;
    }
  }

  /**
   * Read the MIN_PURCHASE_USD constant from BulkComputeGateway so
   * the buy form can validate input before a revert. Falls back to
   * the Solidity default (10_000_000 = $10.00 at 6 decimals) when
   * the address is zero or the read fails.
   */
  async minPurchaseUsd(): Promise<bigint> {
    if (this.addresses.bulkComputeGateway === '0x0000000000000000000000000000000000000000') {
      return 10_000_000n;
    }
    try {
      return (await this.publicClient.readContract({
        address: this.addresses.bulkComputeGateway,
        abi: bulkComputeGatewayAbi,
        functionName: 'MIN_PURCHASE_USD',
      })) as bigint;
    } catch {
      return 10_000_000n;
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
