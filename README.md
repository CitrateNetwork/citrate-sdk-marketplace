# citrate-sdk-marketplace

*Part of the **[Citrate Network](https://citrate.ai)** — own the means of computation. · [Docs](https://docs.citrate.ai) · [Run a node](https://citrate.ai/download) · [Contribute → free membership](https://github.com/CitrateNetwork/.github/blob/main/CONTRIBUTING.md)*
> TypeScript SDK for the Citrate compute marketplace (chain **40204**) — typed contract ABIs, calldata builders, an x402 payment client, and a read-only browsing client built on viem.

## What it is
`@citratelabs/marketplace-sdk` is the client for the Citrate **compute marketplace**:
hand-curated ABIs (InferenceRouter, ComputeMarketplace, ComputePricingOracle,
BulkComputeGateway, ComputePoolTraining, ERC-20), calldata builders for training jobs and
compute-credit purchases, an x402 payment helper, and `MarketplaceClient` — a viem-based,
read-only-by-default client for listing providers and estimating job cost. Deployed contract
addresses for chain 40204 are vendored from the federation-canonical address table, so they
stay in lockstep with the gateway, node-agent, and explorer across a re-roll.

See the concepts in the docs: <https://docs.citrate.ai>.
Depends on a running chain node ([citrate-chain](https://github.com/CitrateNetwork/citrate-chain))
with the marketplace contract book deployed.

## Prerequisites
```bash
node --version   # >= v20 (engines floor)
npm --version
# Optional, only for "Connect it locally": a local Citrate devnet node on :8545
```

## Build from source
```bash
git clone https://github.com/CitrateNetwork/citrate-sdk-marketplace.git
cd citrate-sdk-marketplace
npm install
npm run build        # tsc → dist/ (index.js + index.d.ts)
npm test             # vitest
npm run typecheck    # tsc --noEmit
```
Expected artifact: `dist/`. Only runtime dependency is `viem`. Build is fast and low-RAM.

## Run locally
This is a library — no service, no port. Install it into an app:

```bash
npm install @citratelabs/marketplace-sdk viem
```

30-second Quickstart (against the public testnet, chain 40204):
```ts
import { createPublicClient, http, defineChain } from 'viem';
import { MarketplaceClient, CITRATE_TESTNET_CHAIN_ID } from '@citratelabs/marketplace-sdk';

const citrate = defineChain({
  id: CITRATE_TESTNET_CHAIN_ID,                  // 40204
  name: 'Citrate Network',
  nativeCurrency: { name: 'Citrate', symbol: 'CIT', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.citrate.ai'] } },
});

const publicClient = createPublicClient({ chain: citrate, transport: http() });
const market = new MarketplaceClient({ publicClient }); // testnet addresses by default

// Read-only marketplace browsing (Slice 1):
const providers = await market.listProviders('0x<modelHash>');
console.log('providers for model:', providers);
```
The client defaults to the vendored testnet address book (`TESTNET_ADDRESSES`, chain 40204);
pass `addresses` to override for another deployment.

## Connect it locally  ← the differentiator
Point the SDK at a local chain instead of the public testnet.

1. **Local chain** — run a Citrate devnet node (chain 40204) from
   [citrate-chain](https://github.com/CitrateNetwork/citrate-chain) and deploy the
   marketplace contracts. It exposes JSON-RPC on `http://localhost:8545`.
2. **Point viem at it** and pass the local addresses:
   ```ts
   import { createPublicClient, http, defineChain } from 'viem';
   import { MarketplaceClient, CITRATE_TESTNET_CHAIN_ID } from '@citratelabs/marketplace-sdk';

   const local = defineChain({
     id: CITRATE_TESTNET_CHAIN_ID,               // 40204
     name: 'Citrate Local',
     nativeCurrency: { name: 'Citrate', symbol: 'CIT', decimals: 18 },
     rpcUrls: { default: { http: ['http://localhost:8545'] } },
   });

   const publicClient = createPublicClient({ chain: local, transport: http('http://localhost:8545') });
   const market = new MarketplaceClient({
     publicClient,
     addresses: {                                // your locally-deployed contract addresses
       modelRegistry: '0x...',
       pricingOracle: '0x...',
       inferenceRouter: '0x...',
       computeMarketplace: '0x...',
       bulkComputeGateway: '0x...',
       computePoolTraining: '0x...',
     },
   });
   ```
   Read the local deployment's addresses from the chain repo's generated
   `contracts/addresses/40204.json` (or run `npm run sync-addresses` to refresh the vendored
   copy from it).
3. **End-to-end check** — `await publicClient.getChainId()` returns `40204`; then
   `market.estimateCost(...)` / `market.listProviders(...)` should resolve against your local
   contracts.

For the full multi-repo bring-up, see the LOCAL_STACK guide at <https://docs.citrate.ai>.

## Configuration
There are no env vars — configuration is code-level:

| Setting | Default | Purpose |
|---------|---------|---------|
| `MarketplaceClient({ publicClient })` | — | a viem `PublicClient` bound to your target chain/RPC |
| `MarketplaceClient({ addresses })` | `TESTNET_ADDRESSES` (chain 40204) | override deployed contract addresses |
| `CITRATE_TESTNET_CHAIN_ID` | `40204` | exported constant for chain setup |

Vendored addresses are refreshed with `npm run sync-addresses` (source of truth:
`citrate-chain/contracts/addresses/40204.json`); `npm run sync-addresses:check` fails on drift.

## Links
- Docs: <https://docs.citrate.ai>
- Depends on: [citrate-chain](https://github.com/CitrateNetwork/citrate-chain) (contract book + RPC) · [viem](https://viem.sh)
- Related: [citrate-sdk-js](https://github.com/CitrateNetwork/citrate-sdk-js) (general-purpose SDK + gateway client)
- Contributing (DCO): `CONTRIBUTING.md` · Security: `SECURITY.md` · License: [`LICENSE`](LICENSE)

## License
Apache-2.0.
