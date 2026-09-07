// Direct-to-chain job helpers (CM-04 WP-04.4 / Flow B).
//
// SDK exposes:
//   - postJobCalldata(args): build calldata for ComputeMarketplace.postJob
//   - parseJobEventsFromLogs(logs): typed events from a tx receipt
//
// Live event subscription (`watchJob`) lands in slice 2 alongside
// websocket transport. For now the webapp reads logs from the
// receipt of the postJob tx itself plus subsequent eth_getLogs polls.

import {
  decodeEventLog,
  encodeFunctionData,
  keccak256,
  type Address,
  type Hex,
  type Log,
} from 'viem';

import { computeMarketplaceAbi } from './abi/compute-marketplace.js';
import { isHexAddress } from './x402.js';
import {
  PaymentMethod,
  VerificationTier,
  type PaymentMethodValue,
  type VerificationTierValue,
} from './types.js';

// ── postJob calldata ────────────────────────────────────────────

export interface PostJobArgs {
  /// Pinned model hash (`0x` + 64 hex chars).
  modelHash: Hex;
  /// `inputHash` field on-chain. Either:
  ///   - A `Uint8Array` of arbitrary input bytes (we keccak256 it), or
  ///   - A `Hex` string already in the form the caller wants stored
  ///     (e.g. an IPFS CID encoded as bytes).
  /// See contracts/src/ComputeMarketplace.sol:309 for the on-chain
  /// docstring.
  input: Uint8Array | Hex;
  /// Max price the buyer will pay, in grains (wei).
  maxPriceGrains: bigint;
  /// Verification tier — 0 commitment, 1 zk proof, 2 TEE.
  tier: VerificationTierValue;
  /// Number of blocks to keep the auction open for bids.
  bidWindowBlocks: bigint;
  /// Number of blocks the assigned provider has to deliver after
  /// assignment.
  execWindowBlocks: bigint;
  /// Optional payment method (CM-06 WP-06.4). Defaults to SALT.
  /// When BulkCredits, the calldata targets `postJobWithMethod`
  /// instead of `postJob`, and callers MUST send `value = 0n` with
  /// the resulting tx (the marketplace's NoMixedPayment guard
  /// reverts otherwise).
  paymentMethod?: PaymentMethodValue;
}

/// Build calldata for `ComputeMarketplace.postJob(...)` (or the
/// `postJobWithMethod` overload when `paymentMethod` is supplied).
/// Returns the calldata + the resolved `inputHash` bytes that will
/// be sent.
///
/// The caller is responsible for sending the resulting calldata via
/// their wallet with the right `value`:
///   - SALT path        → `value = maxPriceGrains` (postJob is payable)
///   - BulkCredits path → `value = 0n` (NoMixedPayment guard)
export function postJobCalldata(args: PostJobArgs): {
  data: Hex;
  inputHash: Hex;
} {
  const inputHash =
    args.input instanceof Uint8Array
      ? keccak256(args.input)
      : asBytesHex(args.input);

  const method = args.paymentMethod ?? PaymentMethod.SALT;
  // Route to `postJobWithMethod` only when the caller asked for
  // something other than SALT. Keeping the SALT path on the legacy
  // `postJob` selector means existing indexers that filter by
  // `postJob` selector keep working unchanged.
  const data =
    method === PaymentMethod.SALT
      ? encodeFunctionData({
          abi: computeMarketplaceAbi,
          functionName: 'postJob',
          args: [
            args.modelHash,
            inputHash,
            args.maxPriceGrains,
            args.tier,
            args.bidWindowBlocks,
            args.execWindowBlocks,
          ],
        })
      : encodeFunctionData({
          abi: computeMarketplaceAbi,
          functionName: 'postJobWithMethod',
          args: [
            args.modelHash,
            inputHash,
            args.maxPriceGrains,
            args.tier,
            method,
            args.bidWindowBlocks,
            args.execWindowBlocks,
          ],
        });

  return { data, inputHash };
}

function asBytesHex(h: Hex): Hex {
  if (!/^0x([0-9a-fA-F]{2})*$/.test(h)) {
    throw new Error(`expected hex string with even-length body, got: ${h}`);
  }
  return h;
}

// ── Event parsing ───────────────────────────────────────────────

/// Typed event decoded from a ComputeMarketplace log.
export type JobEvent =
  | {
      kind: 'JobPosted';
      jobId: bigint;
      requester: Address;
      modelHash: Hex;
      blockNumber: bigint;
      txHash: Hex;
    }
  | {
      kind: 'JobAssigned';
      jobId: bigint;
      provider: Address;
      blockNumber: bigint;
      txHash: Hex;
    }
  | {
      kind: 'JobCompleted';
      jobId: bigint;
      provider: Address;
      resultHash: Hex;
      blockNumber: bigint;
      txHash: Hex;
    };

const KNOWN_EVENT_NAMES = new Set(['JobPosted', 'JobAssigned', 'JobCompleted']);

/// Decode logs from a tx receipt or `eth_getLogs` query into typed
/// `JobEvent`s. Logs that don't match a known signature are ignored
/// silently.
///
/// `expectedEmitter` (the ComputeMarketplace address) is REQUIRED and every
/// log whose `log.address` does not match it is dropped — decoding by ABI
/// signature alone would accept a correctly-shaped job event emitted by ANY
/// contract, letting an attacker forge job state. Compared case-insensitively.
/// Audit: SMK-B-006.
export function parseJobEvents(
  logs: readonly Log[],
  expectedEmitter: Address,
): JobEvent[] {
  if (!isHexAddress(expectedEmitter)) {
    throw new Error(
      'parseJobEvents: expectedEmitter must be a 0x-prefixed 20-byte hex address (the ComputeMarketplace contract)',
    );
  }
  const emitter = expectedEmitter.toLowerCase();
  const out: JobEvent[] = [];
  for (const log of logs) {
    if (typeof log.address !== 'string' || log.address.toLowerCase() !== emitter) {
      continue;
    }
    let decoded;
    try {
      decoded = decodeEventLog({
        abi: computeMarketplaceAbi,
        data: log.data,
        topics: log.topics,
      });
    } catch {
      continue;
    }
    if (!KNOWN_EVENT_NAMES.has(decoded.eventName)) continue;
    const blockNumber = log.blockNumber ?? 0n;
    const txHash = (log.transactionHash ?? ('0x' + '00'.repeat(32))) as Hex;

    const args = decoded.args as Record<string, unknown>;
    switch (decoded.eventName) {
      case 'JobPosted':
        out.push({
          kind: 'JobPosted',
          jobId: args.jobId as bigint,
          requester: args.requester as Address,
          modelHash: args.modelHash as Hex,
          blockNumber,
          txHash,
        });
        break;
      case 'JobAssigned':
        out.push({
          kind: 'JobAssigned',
          jobId: args.jobId as bigint,
          provider: args.provider as Address,
          blockNumber,
          txHash,
        });
        break;
      case 'JobCompleted':
        out.push({
          kind: 'JobCompleted',
          jobId: args.jobId as bigint,
          provider: args.provider as Address,
          resultHash: args.resultHash as Hex,
          blockNumber,
          txHash,
        });
        break;
    }
  }
  return out;
}

/// Re-export so consumers don't have to import the literal value.
export const TIER = VerificationTier;
