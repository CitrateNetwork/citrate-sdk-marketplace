// Hand-curated minimal ABI for BulkComputeGateway. Surfaces:
//   - getCreditBalance (view) — used by the webapp's /credits page
//   - MIN_PURCHASE_USD (constant) — used to validate buy-form input
//   - purchaseComputeCredits (write) — CM-06 WP-06.3 slice 2 buy flow
//   - CreditsPurchased + CreditsSpent (events) — history rendering
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
    // CM-06 WP-06.3 slice 2. Payable-via-stablecoin: the caller MUST
    // have ERC20-approved this contract for `amount` on `stablecoin`
    // before calling. Reverts if amount < MIN_PURCHASE_USD, if the
    // stablecoin isn't accepted by StablecoinTreasury, or if the
    // oracle price is stale.
    name: 'purchaseComputeCredits',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'stablecoin', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: 'creditsReceived', type: 'uint256' }],
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
