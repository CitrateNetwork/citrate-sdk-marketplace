// Hand-curated minimal ABI for BulkComputeGateway. Slice 1 surfaces:
//   - getCreditBalance (view) — used by the webapp's /credits page
//   - MIN_PURCHASE_USD (constant) — used to validate buy-form input
//   - CreditsPurchased + CreditsSpent (events) — used to render the
//     transaction history
//
// Mirrors `contracts/src/BulkComputeGateway.sol`. The Rust→TS
// generator (CM-04 RETRO action item) will eventually replace this.
export const bulkComputeGatewayAbi = [
  {
    name: 'getCreditBalance',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'institution', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'MIN_PURCHASE_USD',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'totalCreditsPurchased',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'totalCreditsSpent',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'event',
    name: 'CreditsPurchased',
    inputs: [
      { name: 'institution', type: 'address', indexed: true },
      { name: 'stablecoin', type: 'address', indexed: true },
      { name: 'usdAmount', type: 'uint256' },
      { name: 'creditsReceived', type: 'uint256' },
      { name: 'purchaseIndex', type: 'uint256' },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'CreditsSpent',
    inputs: [
      { name: 'institution', type: 'address', indexed: true },
      { name: 'spender', type: 'address', indexed: true },
      { name: 'creditAmount', type: 'uint256' },
    ],
    anonymous: false,
  },
] as const;
