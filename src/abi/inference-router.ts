// Hand-curated ABI for the read functions the SDK exposes today.
// Slice 2 (CM-04 WP-04.1 follow-up) replaces this with output from the
// Rust→TS generator; until then, KEEP THIS IN SYNC WITH:
//   contracts/src/InferenceRouter.sol
//
// Selectors verified by Rust integration tests:
//   gateway/tests/http_queries_wiring.rs
export const inferenceRouterAbi = [
  {
    name: 'getProviders',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'modelHash', type: 'bytes32' }],
    outputs: [{ type: 'address[]' }],
  },
  {
    name: 'getProviderInfo',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'provider', type: 'address' }],
    outputs: [
      { name: 'endpoint', type: 'string' },
      { name: 'stake', type: 'uint256' },
      { name: 'currentLoad', type: 'uint256' },
      { name: 'totalInferences', type: 'uint256' },
      { name: 'isActive', type: 'bool' },
    ],
  },
] as const;
