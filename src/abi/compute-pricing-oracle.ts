// Hand-curated ABI mirroring contracts/src/ComputePricingOracle.sol.
// Verified by gateway/tests/http_queries_wiring.rs.
export const computePricingOracleAbi = [
  {
    name: 'estimateJobCost',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'modelHash', type: 'bytes32' },
      { name: 'inputTokens', type: 'uint256' },
      { name: 'outputTokens', type: 'uint256' },
      { name: 'tier', type: 'uint8' },
    ],
    outputs: [{ type: 'uint256' }],
  },
] as const;
