// @citrate-ai/marketplace-sdk — public surface.

// Re-export viem's Address + Hex so consumers don't need a direct
// viem dep just for the types we accept.
export type { Address, Hex } from 'viem';

export { computeMarketplaceAbi } from './abi/compute-marketplace.js';
export { computePricingOracleAbi } from './abi/compute-pricing-oracle.js';
export { inferenceRouterAbi } from './abi/inference-router.js';

export {
  CITRATE_TESTNET_CHAIN_ID,
  TESTNET_ADDRESSES,
  defaultAddresses,
  type MarketplaceAddresses,
} from './contracts.js';

export {
  MarketplaceClient,
  type MarketplaceClientOptions,
} from './client.js';

export {
  grainsToSalt,
  grainsToSaltDisplay,
} from './format.js';

export {
  MarketplaceError,
  VerificationTier,
  type ProviderInfo,
  type ProviderProfile,
  type VerificationTierValue,
} from './types.js';

export {
  X402Client,
  bytesToPayment,
  decodePaymentHeader,
  eip712Digest,
  encodePaymentHeader,
  paymentToBytes,
  PAYLOAD_BYTES,
  signChallenge,
  transferWithAuthorizationStructHash,
  wsaltDomainSeparator,
  type PaymentChallenge,
  type PaymentPayload,
  type Signer,
  type X402ClientOptions,
} from './x402.js';
