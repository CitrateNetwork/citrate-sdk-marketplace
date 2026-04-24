# @citrate-ai/marketplace-sdk

TypeScript SDK for the Citrate compute marketplace. Read providers,
estimate inference cost, and (in slice 2) post jobs + watch events
— all via [viem](https://viem.sh).

This package is the canonical TS bindings layer. The buyer webapp
(`citrate_v0.01.1/buyer-webapp/`) consumes it; external integrators
should too.

## Status

**Slice 1** (this release): read-only, hand-curated ABIs.

| Surface | Status |
|---------|--------|
| `MarketplaceClient.listProviders(modelHash)` | ✅ |
| `MarketplaceClient.estimateCost(...)` | ✅ |
| `MarketplaceClient.getProviderProfile(addr)` | ✅ |
| `grainsToSalt` / `grainsToSaltDisplay` formatters | ✅ |
| `postJob` write helper | slice 2 |
| `watchJob(id)` event subscription | slice 2 |
| Rust→TS ABI generator (drift detector) | slice 2 |

The hand-curated ABIs MUST stay in sync with `contracts/src/*.sol`.
Verified against the Rust gateway via shared selector goldens
(`gateway/tests/http_queries_wiring.rs`).

## Install

The SDK is currently consumed via workspace `file:` links — npm
publish lands when the public surface stabilises.

```jsonc
// in your package.json
"@citrate-ai/marketplace-sdk": "file:../sdks/javascript/citrate-marketplace"
```

## Usage

```ts
import { createPublicClient, http, defineChain } from 'viem';
import {
  MarketplaceClient,
  CITRATE_TESTNET_CHAIN_ID,
  grainsToSaltDisplay,
} from '@citrate-ai/marketplace-sdk';

const chain = defineChain({
  id: CITRATE_TESTNET_CHAIN_ID,
  name: 'Citrate Testnet',
  nativeCurrency: { name: 'SALT', symbol: 'SALT', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.citrate.ai'] } },
});

const client = new MarketplaceClient({
  publicClient: createPublicClient({ chain, transport: http() }),
});

const providers = await client.listProviders(
  '0xababababababababababababababababababababababababababababababababab',
);
for (const p of providers) {
  console.log(p.address, grainsToSaltDisplay(p.stake));
}
```

## Development

```bash
npm install
npm test         # vitest, 19 tests
npm run typecheck
npm run build    # outputs dist/
```
