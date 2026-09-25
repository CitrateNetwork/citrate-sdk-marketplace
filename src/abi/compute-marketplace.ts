// Hand-curated minimal ABI for ComputeMarketplace. See
// contracts/src/ComputeMarketplace.sol for the full surface.
//
// Slice 1 exposes only the read functions and `postJob` — enough for
// the buyer webapp's provider browser + direct-to-chain post flow.
// Bidding / dispute / reputation / staking management call sites use
// the contracts directly with the operator wallet, not via this SDK.
export const computeMarketplaceAbi = [
  // ── Provider directory ──
  {
    name: 'allProviders',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'index', type: 'uint256' }],
    outputs: [{ type: 'address' }],
  },
  {
    name: 'getProviderCount',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'getProvider',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'provider', type: 'address' }],
    outputs: [
      {
        type: 'tuple',
        name: 'profile',
        components: [
          { name: 'isRegistered', type: 'bool' },
          { name: 'stake', type: 'uint256' },
          { name: 'totalJobsCompleted', type: 'uint256' },
          { name: 'totalJobsFailed', type: 'uint256' },
          { name: 'reputationScore', type: 'uint256' },
          { name: 'currentActiveJobs', type: 'uint256' },
          { name: 'maxConcurrentJobs', type: 'uint256' },
        ],
      },
    ],
  },
  // ── Job posting (Flow B) ──
  // NOTE: `inputHash` is `bytes` (not bytes32) on-chain, but providers
  // (citrate-node-agent, PBA-L6b-021) only bid when it is the 32-byte
  // keccak256 of the job input. postJobCalldata() computes it from raw
  // bytes and refuses any other shape (e.g. a CID).
  //
  // Two overloads (CM-06 WP-06.1):
  //   postJob (legacy 6-arg) — defaults to PaymentMethod.SALT
  //   postJobWithMethod (7-arg) — explicit PaymentMethod choice
  {
    name: 'postJob',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'modelHash', type: 'bytes32' },
      { name: 'inputHash', type: 'bytes' },
      { name: 'maxPrice', type: 'uint256' },
      { name: 'tier', type: 'uint8' },
      { name: 'bidWindow', type: 'uint256' },
      { name: 'execWindow', type: 'uint256' },
    ],
    outputs: [{ name: 'jobId', type: 'uint256' }],
  },
  {
    name: 'postJobWithMethod',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'modelHash', type: 'bytes32' },
      { name: 'inputHash', type: 'bytes' },
      { name: 'maxPrice', type: 'uint256' },
      { name: 'tier', type: 'uint8' },
      { name: 'paymentMethod', type: 'uint8' },
      { name: 'bidWindow', type: 'uint256' },
      { name: 'execWindow', type: 'uint256' },
    ],
    outputs: [{ name: 'jobId', type: 'uint256' }],
  },
  {
    type: 'event',
    name: 'JobPaymentMethodSet',
    inputs: [
      { name: 'jobId', type: 'uint256', indexed: true },
      { name: 'method', type: 'uint8' },
    ],
    anonymous: false,
  },
  // ── Events tracked by the timeline UI ──
  {
    type: 'event',
    name: 'JobPosted',
    inputs: [
      { name: 'jobId', type: 'uint256', indexed: true },
      { name: 'requester', type: 'address', indexed: true },
      { name: 'modelHash', type: 'bytes32', indexed: true },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'JobAssigned',
    inputs: [
      { name: 'jobId', type: 'uint256', indexed: true },
      { name: 'provider', type: 'address', indexed: true },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'JobCompleted',
    inputs: [
      { name: 'jobId', type: 'uint256', indexed: true },
      { name: 'provider', type: 'address', indexed: true },
      { name: 'resultHash', type: 'bytes32' },
    ],
    anonymous: false,
  },
] as const;
