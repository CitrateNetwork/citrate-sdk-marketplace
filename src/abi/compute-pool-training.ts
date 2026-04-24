// Hand-curated ABI for ComputePoolTraining (CM-07). Covers the
// DataParallel training lifecycle: requestTrainingJob →
// joinTrainingJob → closeRecruitment → commitEpoch × E →
// (challengeStep → voteChallenge) × N → finalizeTrainingJob.
//
// Mirrors contracts/src/ComputePoolTraining.sol verbatim. The
// struct order in TrainingJobSpec MUST match the Solidity struct
// field order — viem encodes by position, not name.
export const computePoolTrainingAbi = [
  // ── Job lifecycle ──
  {
    name: 'requestTrainingJob',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'spec',
        type: 'tuple',
        components: [
          { name: 'modelStartHash', type: 'bytes32' },
          { name: 'datasetHash', type: 'bytes32' },
          { name: 'epochCount', type: 'uint32' },
          { name: 'stepsPerEpoch', type: 'uint32' },
          { name: 'minWorkers', type: 'uint32' },
          { name: 'maxWorkers', type: 'uint32' },
          { name: 'challengeWindowBlocks', type: 'uint32' },
          { name: 'perEpochBudget', type: 'uint128' },
          { name: 'perWorkerStake', type: 'uint128' },
        ],
      },
    ],
    outputs: [{ name: 'jobId', type: 'uint256' }],
  },
  {
    name: 'joinTrainingJob',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: 'jobId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'closeRecruitment',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'jobId', type: 'uint256' },
      { name: 'coordinator', type: 'address' },
    ],
    outputs: [],
  },
  {
    name: 'commitEpoch',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'jobId', type: 'uint256' },
      { name: 'epoch', type: 'uint32' },
      { name: 'root', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    name: 'finalizeTrainingJob',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'jobId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'abortRecruiting',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'jobId', type: 'uint256' }],
    outputs: [],
  },

  // ── Reassignment (WP-07.3) ──
  {
    name: 'reassignCoordinator',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'jobId', type: 'uint256' },
      { name: 'newCoordinator', type: 'address' },
    ],
    outputs: [],
  },

  // ── Challenge lifecycle (WP-07.4) ──
  {
    name: 'challengeStep',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'jobId', type: 'uint256' },
      { name: 'epoch', type: 'uint32' },
      { name: 'step', type: 'uint32' },
      { name: 'target', type: 'address' },
      { name: 'leaf', type: 'bytes32' },
      { name: 'merkleProof', type: 'bytes32[]' },
    ],
    outputs: [],
  },
  {
    name: 'voteChallenge',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'jobId', type: 'uint256' },
      { name: 'epoch', type: 'uint32' },
      { name: 'step', type: 'uint32' },
      { name: 'target', type: 'address' },
      { name: 'uphold', type: 'bool' },
    ],
    outputs: [],
  },

  // ── Views ──
  {
    name: 'getEpochRoot',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'jobId', type: 'uint256' },
      { name: 'epoch', type: 'uint32' },
    ],
    outputs: [{ type: 'bytes32' }],
  },
  {
    name: 'heldStake',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'jobId', type: 'uint256' },
      { name: 'worker', type: 'address' },
    ],
    outputs: [{ type: 'uint128' }],
  },
  {
    name: 'CHALLENGE_BOND',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },

  // ── Events ──
  {
    type: 'event',
    name: 'TrainingJobOpened',
    inputs: [
      { name: 'jobId', type: 'uint256', indexed: true },
      { name: 'requester', type: 'address', indexed: true },
      { name: 'modelStartHash', type: 'bytes32', indexed: false },
      { name: 'datasetHash', type: 'bytes32', indexed: false },
      { name: 'epochCount', type: 'uint32', indexed: false },
      { name: 'stepsPerEpoch', type: 'uint32', indexed: false },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'WorkerJoined',
    inputs: [
      { name: 'jobId', type: 'uint256', indexed: true },
      { name: 'worker', type: 'address', indexed: true },
      { name: 'stake', type: 'uint128', indexed: false },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'RecruitmentClosed',
    inputs: [
      { name: 'jobId', type: 'uint256', indexed: true },
      { name: 'workerCount', type: 'uint32', indexed: false },
      { name: 'coordinator', type: 'address', indexed: false },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'CoordinatorReassigned',
    inputs: [
      { name: 'jobId', type: 'uint256', indexed: true },
      { name: 'oldCoordinator', type: 'address', indexed: true },
      { name: 'newCoordinator', type: 'address', indexed: true },
      { name: 'livenessSlash', type: 'uint128', indexed: false },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'EpochCommitted',
    inputs: [
      { name: 'jobId', type: 'uint256', indexed: true },
      { name: 'epoch', type: 'uint32', indexed: true },
      { name: 'root', type: 'bytes32', indexed: false },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'ChallengeOpened',
    inputs: [
      { name: 'jobId', type: 'uint256', indexed: true },
      { name: 'epoch', type: 'uint32', indexed: true },
      { name: 'step', type: 'uint32', indexed: false },
      { name: 'target', type: 'address', indexed: true },
      { name: 'challenger', type: 'address', indexed: false },
      { name: 'bond', type: 'uint128', indexed: false },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'ChallengeResolved',
    inputs: [
      { name: 'jobId', type: 'uint256', indexed: true },
      { name: 'epoch', type: 'uint32', indexed: true },
      { name: 'step', type: 'uint32', indexed: false },
      { name: 'target', type: 'address', indexed: true },
      { name: 'upheld', type: 'bool', indexed: false },
      { name: 'slashAmount', type: 'uint128', indexed: false },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'TrainingJobCompleted',
    inputs: [
      { name: 'jobId', type: 'uint256', indexed: true },
      { name: 'finalWeightsHash', type: 'bytes32', indexed: false },
    ],
    anonymous: false,
  },
] as const;
