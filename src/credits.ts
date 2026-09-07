// Credits-purchase helpers (CM-06 WP-06.3 slice 2).
//
// The buy flow is two transactions:
//   1. ERC20.approve(gateway, amount)          on the stablecoin
//   2. BulkComputeGateway.purchaseComputeCredits(stablecoin, amount)
//
// This module exposes pure calldata builders; callers send the
// resulting {to, data} via whichever TxSigner backend they hold
// (CitrateWallet or InjectedSigner — both satisfy the TxSigner
// surface from ./x402.js).
//
// Event parsing for CreditsPurchased / CreditsSpent lives in
// parseCreditsEvents below — caller polls receipt logs or
// eth_getLogs and feeds them in.
import {
  decodeEventLog,
  encodeFunctionData,
  type Address,
  type Hex,
  type Log,
} from 'viem';

import { bulkComputeGatewayAbi } from './abi/bulk-compute-gateway.js';
import { erc20Abi } from './abi/erc20.js';
import { isHexAddress } from './x402.js';

// ── Calldata builders ───────────────────────────────────────────

export interface Erc20ApproveArgs {
  /// The spender that will be authorised to pull `amount` on behalf
  /// of the caller. For the credits buy flow this is the
  /// BulkComputeGateway address.
  spender: Address;
  /// Amount in the stablecoin's native decimals (typically 6 for
  /// USDC/USDT). The buy flow uses `usdAmount` verbatim — do not
  /// rescale to 18 decimals before passing it in.
  amount: bigint;
}

/// Build calldata for ERC20.approve(spender, amount). Send the
/// resulting {to: stablecoin, data, value: 0n} via TxSigner.
export function erc20ApproveCalldata(args: Erc20ApproveArgs): { data: Hex } {
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'approve',
    args: [args.spender, args.amount],
  });
  return { data };
}

export interface PurchaseComputeCreditsArgs {
  /// Stablecoin the buyer pays with. Must be on the treasury's
  /// acceptedStablecoins list, else the tx reverts.
  stablecoin: Address;
  /// Amount of stablecoin in its native decimals (6 for USDC).
  /// Must be ≥ MIN_PURCHASE_USD (10_000_000 = $10.00 at 6 decimals).
  amount: bigint;
}

/// Build calldata for BulkComputeGateway.purchaseComputeCredits.
/// Send the resulting {to: gateway, data, value: 0n} via TxSigner.
/// The oracle price is consumed at execution time; the amount of
/// credits received is returned on-chain and emitted in
/// CreditsPurchased.
export function purchaseComputeCreditsCalldata(
  args: PurchaseComputeCreditsArgs,
): { data: Hex } {
  const data = encodeFunctionData({
    abi: bulkComputeGatewayAbi,
    functionName: 'purchaseComputeCredits',
    args: [args.stablecoin, args.amount],
  });
  return { data };
}

// ── Event parsing ───────────────────────────────────────────────

export type CreditsEvent =
  | {
      kind: 'CreditsPurchased';
      institution: Address;
      stablecoin: Address;
      usdAmount: bigint;
      creditsReceived: bigint;
      purchaseIndex: bigint;
      blockNumber: bigint;
      txHash: Hex;
    }
  | {
      kind: 'CreditsSpent';
      institution: Address;
      spender: Address;
      creditAmount: bigint;
      blockNumber: bigint;
      txHash: Hex;
    };

const KNOWN_CREDITS_EVENTS = new Set(['CreditsPurchased', 'CreditsSpent']);

/// Decode CreditsPurchased + CreditsSpent logs from a tx receipt or
/// eth_getLogs. Unknown logs are skipped silently so callers can pass
/// mixed-ABI receipts through without pre-filtering.
///
/// `expectedEmitter` (the BulkComputeGateway address) is REQUIRED and every
/// log whose `log.address` does not match it is dropped — decoding by ABI
/// signature alone accepts a correctly-shaped `CreditsPurchased` emitted by
/// ANY contract, letting an attacker forge purchase history. Compared
/// case-insensitively. Audit: SMK-B-006.
export function parseCreditsEvents(
  logs: readonly Log[],
  expectedEmitter: Address,
): CreditsEvent[] {
  if (!isHexAddress(expectedEmitter)) {
    throw new Error(
      'parseCreditsEvents: expectedEmitter must be a 0x-prefixed 20-byte hex address (the emitting gateway)',
    );
  }
  const emitter = expectedEmitter.toLowerCase();
  const out: CreditsEvent[] = [];
  for (const log of logs) {
    // Reject any log not emitted by the pinned gateway before decoding.
    if (typeof log.address !== 'string' || log.address.toLowerCase() !== emitter) {
      continue;
    }
    let decoded;
    try {
      decoded = decodeEventLog({
        abi: bulkComputeGatewayAbi,
        data: log.data,
        topics: log.topics,
      });
    } catch {
      continue;
    }
    if (!KNOWN_CREDITS_EVENTS.has(decoded.eventName)) continue;
    const blockNumber = log.blockNumber ?? 0n;
    const txHash = (log.transactionHash ?? ('0x' + '00'.repeat(32))) as Hex;
    const args = decoded.args as Record<string, unknown>;
    switch (decoded.eventName) {
      case 'CreditsPurchased':
        out.push({
          kind: 'CreditsPurchased',
          institution: args.institution as Address,
          stablecoin: args.stablecoin as Address,
          usdAmount: args.usdAmount as bigint,
          creditsReceived: args.creditsReceived as bigint,
          purchaseIndex: args.purchaseIndex as bigint,
          blockNumber,
          txHash,
        });
        break;
      case 'CreditsSpent':
        out.push({
          kind: 'CreditsSpent',
          institution: args.institution as Address,
          spender: args.spender as Address,
          creditAmount: args.creditAmount as bigint,
          blockNumber,
          txHash,
        });
        break;
    }
  }
  return out;
}
