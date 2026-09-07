// Training-job helpers (CM-07). Build calldata for the
// ComputePoolTraining lifecycle, parse receipt/log events into
// typed shapes.
//
// The SDK does NOT send transactions; it only builds calldata and
// decodes events. The caller holds the wallet (CitrateWallet /
// InjectedSigner per W-01) and drives broadcast + receipt polling.
import {
  decodeEventLog,
  encodeFunctionData,
  type Address,
  type Hex,
  type Log,
} from 'viem';

import { computePoolTrainingAbi } from './abi/compute-pool-training.js';
import { isHexAddress } from './x402.js';

// ── Types ───────────────────────────────────────────────────────

/// Training-job spec mirroring ComputePoolTraining.TrainingJobSpec.
/// All integer fields are bigint so callers can supply the full
/// uint128 range without silent truncation.
export interface TrainingJobSpec {
  modelStartHash: Hex;
  datasetHash: Hex;
  epochCount: number;
  stepsPerEpoch: number;
  minWorkers: number;
  maxWorkers: number;
  challengeWindowBlocks: number;
  perEpochBudget: bigint;
  perWorkerStake: bigint;
}

// ── Calldata builders ───────────────────────────────────────────

/// Build calldata for `requestTrainingJob(TrainingJobSpec)`. The
/// caller must send `value = perEpochBudget × epochCount` — the
/// contract reverts otherwise.
export function requestTrainingJobCalldata(spec: TrainingJobSpec): {
  data: Hex;
  requiredEscrow: bigint;
} {
  const data = encodeFunctionData({
    abi: computePoolTrainingAbi,
    functionName: 'requestTrainingJob',
    args: [
      {
        modelStartHash: spec.modelStartHash,
        datasetHash: spec.datasetHash,
        epochCount: spec.epochCount,
        stepsPerEpoch: spec.stepsPerEpoch,
        minWorkers: spec.minWorkers,
        maxWorkers: spec.maxWorkers,
        challengeWindowBlocks: spec.challengeWindowBlocks,
        perEpochBudget: spec.perEpochBudget,
        perWorkerStake: spec.perWorkerStake,
      },
    ],
  });
  const requiredEscrow = spec.perEpochBudget * BigInt(spec.epochCount);
  return { data, requiredEscrow };
}

export function joinTrainingJobCalldata(jobId: bigint): { data: Hex } {
  return {
    data: encodeFunctionData({
      abi: computePoolTrainingAbi,
      functionName: 'joinTrainingJob',
      args: [jobId],
    }),
  };
}

export function closeRecruitmentCalldata(
  jobId: bigint,
  coordinator: Address,
): { data: Hex } {
  return {
    data: encodeFunctionData({
      abi: computePoolTrainingAbi,
      functionName: 'closeRecruitment',
      args: [jobId, coordinator],
    }),
  };
}

export function commitEpochCalldata(
  jobId: bigint,
  epoch: number,
  root: Hex,
): { data: Hex } {
  return {
    data: encodeFunctionData({
      abi: computePoolTrainingAbi,
      functionName: 'commitEpoch',
      args: [jobId, epoch, root],
    }),
  };
}

export function finalizeTrainingJobCalldata(jobId: bigint): { data: Hex } {
  return {
    data: encodeFunctionData({
      abi: computePoolTrainingAbi,
      functionName: 'finalizeTrainingJob',
      args: [jobId],
    }),
  };
}

export function reassignCoordinatorCalldata(
  jobId: bigint,
  newCoordinator: Address,
): { data: Hex } {
  return {
    data: encodeFunctionData({
      abi: computePoolTrainingAbi,
      functionName: 'reassignCoordinator',
      args: [jobId, newCoordinator],
    }),
  };
}

export function challengeStepCalldata(args: {
  jobId: bigint;
  epoch: number;
  step: number;
  target: Address;
  leaf: Hex;
  merkleProof: readonly Hex[];
}): { data: Hex } {
  return {
    data: encodeFunctionData({
      abi: computePoolTrainingAbi,
      functionName: 'challengeStep',
      args: [args.jobId, args.epoch, args.step, args.target, args.leaf, args.merkleProof as Hex[]],
    }),
  };
}

export function voteChallengeCalldata(args: {
  jobId: bigint;
  epoch: number;
  step: number;
  target: Address;
  uphold: boolean;
}): { data: Hex } {
  return {
    data: encodeFunctionData({
      abi: computePoolTrainingAbi,
      functionName: 'voteChallenge',
      args: [args.jobId, args.epoch, args.step, args.target, args.uphold],
    }),
  };
}

// ── Event parsing ───────────────────────────────────────────────

export type TrainingEvent =
  | {
      kind: 'TrainingJobOpened';
      jobId: bigint;
      requester: Address;
      modelStartHash: Hex;
      datasetHash: Hex;
      epochCount: number;
      stepsPerEpoch: number;
      blockNumber: bigint;
      txHash: Hex;
    }
  | {
      kind: 'WorkerJoined';
      jobId: bigint;
      worker: Address;
      stake: bigint;
      blockNumber: bigint;
      txHash: Hex;
    }
  | {
      kind: 'RecruitmentClosed';
      jobId: bigint;
      workerCount: number;
      coordinator: Address;
      blockNumber: bigint;
      txHash: Hex;
    }
  | {
      kind: 'CoordinatorReassigned';
      jobId: bigint;
      oldCoordinator: Address;
      newCoordinator: Address;
      livenessSlash: bigint;
      blockNumber: bigint;
      txHash: Hex;
    }
  | {
      kind: 'EpochCommitted';
      jobId: bigint;
      epoch: number;
      root: Hex;
      blockNumber: bigint;
      txHash: Hex;
    }
  | {
      kind: 'ChallengeOpened';
      jobId: bigint;
      epoch: number;
      step: number;
      target: Address;
      challenger: Address;
      bond: bigint;
      blockNumber: bigint;
      txHash: Hex;
    }
  | {
      kind: 'ChallengeResolved';
      jobId: bigint;
      epoch: number;
      step: number;
      target: Address;
      upheld: boolean;
      slashAmount: bigint;
      blockNumber: bigint;
      txHash: Hex;
    }
  | {
      kind: 'TrainingJobCompleted';
      jobId: bigint;
      finalWeightsHash: Hex;
      blockNumber: bigint;
      txHash: Hex;
    };

const KNOWN = new Set([
  'TrainingJobOpened',
  'WorkerJoined',
  'RecruitmentClosed',
  'CoordinatorReassigned',
  'EpochCommitted',
  'ChallengeOpened',
  'ChallengeResolved',
  'TrainingJobCompleted',
]);

/// Decode a list of logs into typed TrainingEvent values. Unknown
/// topics are silently skipped, so callers can pass mixed-ABI
/// receipts through without pre-filtering.
///
/// `expectedEmitter` (the ComputePoolTraining address) is REQUIRED and every
/// log whose `log.address` does not match it is dropped — decoding by ABI
/// signature alone would accept a correctly-shaped training event emitted by
/// ANY contract, letting an attacker forge job state. Compared
/// case-insensitively. Audit: SMK-B-006.
export function parseTrainingEvents(
  logs: readonly Log[],
  expectedEmitter: Address,
): TrainingEvent[] {
  if (!isHexAddress(expectedEmitter)) {
    throw new Error(
      'parseTrainingEvents: expectedEmitter must be a 0x-prefixed 20-byte hex address (the ComputePoolTraining contract)',
    );
  }
  const emitter = expectedEmitter.toLowerCase();
  const out: TrainingEvent[] = [];
  for (const log of logs) {
    if (typeof log.address !== 'string' || log.address.toLowerCase() !== emitter) {
      continue;
    }
    let decoded;
    try {
      decoded = decodeEventLog({
        abi: computePoolTrainingAbi,
        data: log.data,
        topics: log.topics,
      });
    } catch {
      continue;
    }
    if (!KNOWN.has(decoded.eventName)) continue;
    const blockNumber = log.blockNumber ?? 0n;
    const txHash = (log.transactionHash ?? ('0x' + '00'.repeat(32))) as Hex;
    const args = decoded.args as Record<string, unknown>;
    switch (decoded.eventName) {
      case 'TrainingJobOpened':
        out.push({
          kind: 'TrainingJobOpened',
          jobId: args.jobId as bigint,
          requester: args.requester as Address,
          modelStartHash: args.modelStartHash as Hex,
          datasetHash: args.datasetHash as Hex,
          epochCount: Number(args.epochCount),
          stepsPerEpoch: Number(args.stepsPerEpoch),
          blockNumber,
          txHash,
        });
        break;
      case 'WorkerJoined':
        out.push({
          kind: 'WorkerJoined',
          jobId: args.jobId as bigint,
          worker: args.worker as Address,
          stake: args.stake as bigint,
          blockNumber,
          txHash,
        });
        break;
      case 'RecruitmentClosed':
        out.push({
          kind: 'RecruitmentClosed',
          jobId: args.jobId as bigint,
          workerCount: Number(args.workerCount),
          coordinator: args.coordinator as Address,
          blockNumber,
          txHash,
        });
        break;
      case 'CoordinatorReassigned':
        out.push({
          kind: 'CoordinatorReassigned',
          jobId: args.jobId as bigint,
          oldCoordinator: args.oldCoordinator as Address,
          newCoordinator: args.newCoordinator as Address,
          livenessSlash: args.livenessSlash as bigint,
          blockNumber,
          txHash,
        });
        break;
      case 'EpochCommitted':
        out.push({
          kind: 'EpochCommitted',
          jobId: args.jobId as bigint,
          epoch: Number(args.epoch),
          root: args.root as Hex,
          blockNumber,
          txHash,
        });
        break;
      case 'ChallengeOpened':
        out.push({
          kind: 'ChallengeOpened',
          jobId: args.jobId as bigint,
          epoch: Number(args.epoch),
          step: Number(args.step),
          target: args.target as Address,
          challenger: args.challenger as Address,
          bond: args.bond as bigint,
          blockNumber,
          txHash,
        });
        break;
      case 'ChallengeResolved':
        out.push({
          kind: 'ChallengeResolved',
          jobId: args.jobId as bigint,
          epoch: Number(args.epoch),
          step: Number(args.step),
          target: args.target as Address,
          upheld: args.upheld as boolean,
          slashAmount: args.slashAmount as bigint,
          blockNumber,
          txHash,
        });
        break;
      case 'TrainingJobCompleted':
        out.push({
          kind: 'TrainingJobCompleted',
          jobId: args.jobId as bigint,
          finalWeightsHash: args.finalWeightsHash as Hex,
          blockNumber,
          txHash,
        });
        break;
    }
  }
  return out;
}
