// Tests for the training-job SDK helpers (CM-07 WP-07.5).

import { describe, expect, test } from 'vitest';
import {
  decodeFunctionData,
  encodeAbiParameters,
  keccak256,
  slice,
  type Hex,
  type Log,
} from 'viem';

import { computePoolTrainingAbi } from '../src/abi/compute-pool-training.js';
import {
  challengeStepCalldata,
  closeRecruitmentCalldata,
  commitEpochCalldata,
  finalizeTrainingJobCalldata,
  joinTrainingJobCalldata,
  parseTrainingEvents,
  reassignCoordinatorCalldata,
  requestTrainingJobCalldata,
  voteChallengeCalldata,
  type TrainingJobSpec,
} from '../src/training.js';

const MODEL_HASH = ('0x' + 'aa'.repeat(32)) as Hex;
const DATASET_HASH = ('0x' + 'bb'.repeat(32)) as Hex;
const COORDINATOR = ('0x' + 'c1'.repeat(20)) as `0x${string}`;
const TARGET = ('0x' + 'c2'.repeat(20)) as `0x${string}`;
const ONE_SALT = 10n ** 18n;

function spec(): TrainingJobSpec {
  return {
    modelStartHash: MODEL_HASH,
    datasetHash: DATASET_HASH,
    epochCount: 2,
    stepsPerEpoch: 100,
    minWorkers: 3,
    maxWorkers: 5,
    challengeWindowBlocks: 50,
    perEpochBudget: 30n * ONE_SALT,
    perWorkerStake: 10n * ONE_SALT,
  };
}

describe('requestTrainingJobCalldata', () => {
  test('selector matches requestTrainingJob signature', () => {
    const { data } = requestTrainingJobCalldata(spec());
    const sigHash = keccak256(
      new TextEncoder().encode(
        'requestTrainingJob((bytes32,bytes32,uint32,uint32,uint32,uint32,uint32,uint128,uint128))',
      ),
    );
    expect(slice(data, 0, 4)).toBe(slice(sigHash, 0, 4));
  });

  test('required escrow = perEpochBudget × epochCount', () => {
    const { requiredEscrow } = requestTrainingJobCalldata(spec());
    expect(requiredEscrow).toBe(60n * ONE_SALT);
  });

  test('round-trips all spec fields', () => {
    const s = spec();
    const { data } = requestTrainingJobCalldata(s);
    const decoded = decodeFunctionData({
      abi: computePoolTrainingAbi,
      data,
    });
    expect(decoded.functionName).toBe('requestTrainingJob');
    const struct = decoded.args?.[0] as {
      modelStartHash: Hex;
      datasetHash: Hex;
      epochCount: number;
      stepsPerEpoch: number;
      minWorkers: number;
      maxWorkers: number;
      challengeWindowBlocks: number;
      perEpochBudget: bigint;
      perWorkerStake: bigint;
    };
    expect(struct.modelStartHash).toBe(s.modelStartHash);
    expect(struct.datasetHash).toBe(s.datasetHash);
    expect(struct.epochCount).toBe(s.epochCount);
    expect(struct.stepsPerEpoch).toBe(s.stepsPerEpoch);
    expect(struct.minWorkers).toBe(s.minWorkers);
    expect(struct.maxWorkers).toBe(s.maxWorkers);
    expect(struct.challengeWindowBlocks).toBe(s.challengeWindowBlocks);
    expect(struct.perEpochBudget).toBe(s.perEpochBudget);
    expect(struct.perWorkerStake).toBe(s.perWorkerStake);
  });
});

describe('joinTrainingJobCalldata', () => {
  test('selector + jobId round-trip', () => {
    const { data } = joinTrainingJobCalldata(42n);
    const decoded = decodeFunctionData({ abi: computePoolTrainingAbi, data });
    expect(decoded.functionName).toBe('joinTrainingJob');
    expect(decoded.args?.[0]).toBe(42n);
  });
});

describe('closeRecruitmentCalldata', () => {
  test('encodes jobId + coordinator', () => {
    const { data } = closeRecruitmentCalldata(7n, COORDINATOR);
    const decoded = decodeFunctionData({ abi: computePoolTrainingAbi, data });
    expect(decoded.functionName).toBe('closeRecruitment');
    expect(decoded.args?.[0]).toBe(7n);
    expect((decoded.args?.[1] as string).toLowerCase()).toBe(COORDINATOR);
  });
});

describe('commitEpochCalldata', () => {
  test('encodes jobId + epoch + root', () => {
    const root = ('0x' + 'ee'.repeat(32)) as Hex;
    const { data } = commitEpochCalldata(3n, 5, root);
    const decoded = decodeFunctionData({ abi: computePoolTrainingAbi, data });
    expect(decoded.functionName).toBe('commitEpoch');
    expect(decoded.args?.[0]).toBe(3n);
    expect(decoded.args?.[1]).toBe(5);
    expect(decoded.args?.[2]).toBe(root);
  });
});

describe('finalizeTrainingJobCalldata', () => {
  test('encodes jobId', () => {
    const { data } = finalizeTrainingJobCalldata(99n);
    const decoded = decodeFunctionData({ abi: computePoolTrainingAbi, data });
    expect(decoded.functionName).toBe('finalizeTrainingJob');
    expect(decoded.args?.[0]).toBe(99n);
  });
});

describe('reassignCoordinatorCalldata', () => {
  test('encodes jobId + newCoordinator', () => {
    const { data } = reassignCoordinatorCalldata(1n, COORDINATOR);
    const decoded = decodeFunctionData({ abi: computePoolTrainingAbi, data });
    expect(decoded.functionName).toBe('reassignCoordinator');
    expect(decoded.args?.[0]).toBe(1n);
    expect((decoded.args?.[1] as string).toLowerCase()).toBe(COORDINATOR);
  });
});

describe('challengeStepCalldata', () => {
  test('encodes full challenge args including proof array', () => {
    const leaf = ('0x' + 'ff'.repeat(32)) as Hex;
    const proof = [
      ('0x' + '11'.repeat(32)) as Hex,
      ('0x' + '22'.repeat(32)) as Hex,
    ];
    const { data } = challengeStepCalldata({
      jobId: 42n,
      epoch: 0,
      step: 3,
      target: TARGET,
      leaf,
      merkleProof: proof,
    });
    const decoded = decodeFunctionData({ abi: computePoolTrainingAbi, data });
    expect(decoded.functionName).toBe('challengeStep');
    expect(decoded.args?.[0]).toBe(42n);
    expect(decoded.args?.[1]).toBe(0);
    expect(decoded.args?.[2]).toBe(3);
    expect((decoded.args?.[3] as string).toLowerCase()).toBe(TARGET);
    expect(decoded.args?.[4]).toBe(leaf);
    expect(decoded.args?.[5]).toEqual(proof);
  });
});

describe('voteChallengeCalldata', () => {
  test('encodes all vote fields', () => {
    const { data } = voteChallengeCalldata({
      jobId: 1n,
      epoch: 0,
      step: 0,
      target: TARGET,
      uphold: true,
    });
    const decoded = decodeFunctionData({ abi: computePoolTrainingAbi, data });
    expect(decoded.functionName).toBe('voteChallenge');
    expect(decoded.args?.[4]).toBe(true);
  });
});

describe('parseTrainingEvents', () => {
  function epochCommittedLog(
    jobId: bigint,
    epoch: number,
    root: Hex,
  ): Log {
    const sigHash = keccak256(
      new TextEncoder().encode('EpochCommitted(uint256,uint32,bytes32)'),
    );
    return {
      address: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as Hex,
      blockNumber: 100n,
      blockHash: ('0x' + '00'.repeat(32)) as Hex,
      data: root,
      logIndex: 0,
      removed: false,
      transactionHash: ('0x' + '11'.repeat(32)) as Hex,
      transactionIndex: 0,
      topics: [
        sigHash,
        encodeAbiParameters([{ type: 'uint256' }], [jobId]) as Hex,
        encodeAbiParameters([{ type: 'uint32' }], [epoch]) as Hex,
      ],
    } as Log;
  }

  test('decodes EpochCommitted', () => {
    const root = ('0x' + 'ab'.repeat(32)) as Hex;
    const log = epochCommittedLog(42n, 1, root);
    const events = parseTrainingEvents([log]);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('EpochCommitted');
    if (events[0].kind === 'EpochCommitted') {
      expect(events[0].jobId).toBe(42n);
      expect(events[0].epoch).toBe(1);
      expect(events[0].root).toBe(root);
    }
  });

  test('skips unknown event signatures silently', () => {
    const noise = {
      address: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as Hex,
      blockNumber: 1n,
      blockHash: ('0x' + '00'.repeat(32)) as Hex,
      data: '0x' as Hex,
      logIndex: 0,
      removed: false,
      transactionHash: ('0x' + '22'.repeat(32)) as Hex,
      transactionIndex: 0,
      topics: [('0x' + 'ff'.repeat(32)) as Hex],
    } as Log;
    expect(parseTrainingEvents([noise])).toEqual([]);
  });
});
