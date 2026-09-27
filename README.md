<div align="center">

# @citratelabs/marketplace-sdk

**The TypeScript SDK for the Citrate compute marketplace** — buy AI inference and GPU training compute, on-chain, from any Node.js or browser app.

Typed contract ABIs · calldata builders · an [x402](https://docs.citrate.ai) payment client · a read-only browsing client — all built on [viem](https://viem.sh) for the **Citrate Network** (EVM chain **40204**).

[![npm version](https://img.shields.io/npm/v/@citratelabs/marketplace-sdk.svg?logo=npm)](https://www.npmjs.com/package/@citratelabs/marketplace-sdk)
[![npm downloads](https://img.shields.io/npm/dm/@citratelabs/marketplace-sdk.svg)](https://www.npmjs.com/package/@citratelabs/marketplace-sdk)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)
[![types](https://img.shields.io/badge/types-included-blue.svg)](#api-reference)
[![chain](https://img.shields.io/badge/chain-40204-6f42c1.svg)](https://explorer.citrate.ai)
[![built with viem](https://img.shields.io/badge/built%20with-viem-1a1a1a.svg)](https://viem.sh)

[Website](https://citrate.ai) · [Docs](https://docs.citrate.ai) · [Explorer](https://explorer.citrate.ai) · [Run a node](https://citrate.ai/download) · [npm](https://www.npmjs.com/package/@citratelabs/marketplace-sdk) · [Contribute → free membership](https://github.com/CitrateNetwork/.github/blob/main/CONTRIBUTING.md)

</div>

---

`@citratelabs/marketplace-sdk` lets any TypeScript or JavaScript application **discover compute providers, price and post jobs, purchase compute credits, and settle payments** on the [Citrate Network](https://citrate.ai) — a GhostDAG L1 (chain ID **40204**) whose money path is a decentralized marketplace for **AI inference and federated GPU training**. It ships hand-curated ABIs, calldata builders for the marketplace contracts, an x402 (HTTP-402) payment client matching the Rust gateway, and `MarketplaceClient`, a viem-based read client that defaults to the live testnet address book. Its only runtime dependency is `viem`.

## Quick facts

| | |
|---|---|
| **Package** | `@citratelabs/marketplace-sdk` (public npm) |
| **What it does** | Client SDK for the Citrate compute marketplace: browse providers, estimate/post jobs, buy compute credits, sign x402 payments |
| **Chain** | Citrate Network — EVM-compatible, GhostDAG, chain ID **40204**, RPC `https://rpc.citrate.ai` |
| **Language / target** | TypeScript, ESM, Node.js ≥ 20 and modern browsers |
| **Runtime dependency** | [`viem`](https://viem.sh) `^2.56` (peer to your app's client) |
| **License** | Apache-2.0 · Licensor: Citrate Inc. |
| **Repository** | [github.com/CitrateNetwork/citrate-sdk-marketplace](https://github.com/CitrateNetwork/citrate-sdk-marketplace) |
| **Docs** | [docs.citrate.ai](https://docs.citrate.ai) |

## Table of contents
- [What is @citratelabs/marketplace-sdk?](#what-is-citratelabsmarketplace-sdk)
- [Features](#features)
- [Install](#install)
- [Quickstart](#quickstart)
- [API reference](#api-reference)
- [Concepts](#concepts)
- [Connect it to a local chain](#connect-it-to-a-local-chain)
- [Configuration](#configuration)
- [For AI agents & assistants](#for-ai-agents--assistants)
- [FAQ](#faq)
- [Ecosystem](#ecosystem)
- [Contributing, security & license](#contributing-security--license)

## What is @citratelabs/marketplace-sdk?

It is the official client library for the **Citrate compute marketplace** — the on-chain market where buyers pay for AI inference and GPU training and providers earn for supplying compute. Instead of hand-writing ABIs and calldata against the marketplace contracts, you install one typed package and call:

- `MarketplaceClient` — a read-only-by-default [viem](https://viem.sh) client to **list providers** for a model and **estimate a job's cost**;
- **calldata builders** — pure functions that return ready-to-send transaction data for posting jobs, requesting/joining training jobs, and purchasing compute credits;
- an **`X402Client`** — the payment client for Citrate's HTTP-402 "pay-per-request" flow, matching the Rust inference gateway byte-for-byte;
- a **wallet module** — encrypted keystore and injected (EIP-1193) signers so browser apps can sign without extra deps.

Deployed contract addresses for chain 40204 are **vendored from the federation-canonical address table**, so they stay in lockstep with the gateway, node-agent, and explorer across a chain re-roll.

## Features

- 🧠 **Compute-marketplace client** — discover providers, estimate cost, post jobs (`MarketplaceClient`, `postJobCalldata`).
- 🏋️ **Federated training** — request, join, coordinate, challenge and finalize distributed training jobs (`requestTrainingJobCalldata`, `joinTrainingJobCalldata`, `commitEpochCalldata`, …).
- 💳 **Compute credits** — ERC-20 approve + purchase flows (`erc20ApproveCalldata`, `purchaseComputeCreditsCalldata`).
- ⚡ **x402 payments** — EIP-712 `transferWithAuthorization` signing, header encode/decode, challenge signing (`X402Client`, `signChallenge`).
- 🔐 **Wallets** — encrypted browser keystore + injected EIP-1193 signer (`createWallet`, `InjectedSigner`).
- 🧾 **Typed ABIs** — `inferenceRouterAbi`, `computeMarketplaceAbi`, `computePricingOracleAbi`, `bulkComputeGatewayAbi`, `computePoolTrainingAbi`, `erc20Abi`.
- 🔎 **Event parsers** — decode on-chain logs into typed events (`parseJobEvents`, `parseTrainingEvents`, `parseCreditsEvents`).
- 📦 **Zero-config addresses** — ships the canonical chain-40204 address book; override for any deployment.
- 🪶 **Tiny** — one runtime dep (`viem`), full `.d.ts` types, tree-shakeable ESM.

## Install

```bash
npm install @citratelabs/marketplace-sdk viem
# pnpm add @citratelabs/marketplace-sdk viem
# yarn add @citratelabs/marketplace-sdk viem
# bun add @citratelabs/marketplace-sdk viem
```

Public npm — no auth token or private registry required.

## Quickstart

Browse the live testnet marketplace (chain 40204) in ~30 seconds:

```ts
import { createPublicClient, http, defineChain } from 'viem';
import { MarketplaceClient, CITRATE_TESTNET_CHAIN_ID } from '@citratelabs/marketplace-sdk';

const citrate = defineChain({
  id: CITRATE_TESTNET_CHAIN_ID,                 // 40204
  name: 'Citrate Network',
  nativeCurrency: { name: 'Citrate', symbol: 'CIT', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.citrate.ai'] } },
});

const publicClient = createPublicClient({ chain: citrate, transport: http() });
const market = new MarketplaceClient({ publicClient }); // testnet address book by default

const providers = await market.listProviders('0x<modelHash>');
const quote = await market.estimateCost(/* job spec */);
console.log({ providers, quote });
```

Post a job (build calldata, sign with your wallet, send with viem):

```ts
import { postJobCalldata } from '@citratelabs/marketplace-sdk';

const data = postJobCalldata({ /* PostJobArgs */ });
const hash = await walletClient.sendTransaction({ to: computeMarketplaceAddress, data });
```

## API reference

All exports are typed and tree-shakeable. Import only what you use.

### Client
| Export | Purpose |
|---|---|
| `MarketplaceClient` | viem-based, read-only-by-default client — `listProviders(modelHash)`, `estimateCost(...)` |
| `MarketplaceClientOptions` | `{ publicClient, addresses? }` |

### Calldata builders & event parsers
| Group | Exports |
|---|---|
| **Jobs** | `postJobCalldata`, `parseJobEvents`, `TIER`, types `PostJobArgs`, `JobEvent` |
| **Training** | `requestTrainingJobCalldata`, `joinTrainingJobCalldata`, `closeRecruitmentCalldata`, `commitEpochCalldata`, `challengeStepCalldata`, `voteChallengeCalldata`, `reassignCoordinatorCalldata`, `finalizeTrainingJobCalldata`, `parseTrainingEvents`, types `TrainingJobSpec`, `TrainingEvent` |
| **Credits** | `purchaseComputeCreditsCalldata`, `erc20ApproveCalldata`, `parseCreditsEvents`, types `PurchaseComputeCreditsArgs`, `Erc20ApproveArgs`, `CreditsEvent` |

### x402 payment client
`X402Client`, `signChallenge`, `encodePaymentHeader`, `decodePaymentHeader`, `paymentToBytes`, `bytesToPayment`, `eip712Digest`, `transferWithAuthorizationStructHash`, `wsaltDomainSeparator`, `isTxSigner`, `PAYLOAD_BYTES` · types `PaymentChallenge`, `PaymentPayload`, `Signer`, `TxSigner`, `X402ClientOptions`.

### Wallet
`createWallet`, `unlockWallet`, `encryptKeystore`, `decryptKeystore`, `peekKeystoreAddress`, `hasStoredKeystore`, `clearKeystore`, `CitrateWallet`, `InjectedSigner`, `hasInjectedProvider`, `WalletKind` · types `Keystore`, `CitrateWalletState`, `EthereumProvider`, `InjectedSignerOptions`, `WalletKindValue`.

### ABIs
`inferenceRouterAbi`, `computeMarketplaceAbi`, `computePricingOracleAbi`, `bulkComputeGatewayAbi`, `computePoolTrainingAbi`, `erc20Abi`.

### Addresses, formatting & types
`CITRATE_TESTNET_CHAIN_ID` (`40204`), `TESTNET_ADDRESSES`, `defaultAddresses()`, type `MarketplaceAddresses` · `grainsToSalt`, `grainsToSaltDisplay` (SALT base-unit "grains" → display) · `PaymentMethod`, `VerificationTier`, `MarketplaceError`, types `ProviderInfo`, `ProviderProfile`, and re-exported `Address`, `Hex` from viem.

## Concepts

- **Compute marketplace** — buyers post inference/training jobs; providers are matched, priced by `ComputePricingOracle`, routed by `InferenceRouter`, and settled on `ComputeMarketplace`. Learn more at [docs.citrate.ai](https://docs.citrate.ai).
- **x402 payments** — Citrate's HTTP-402 pay-per-request scheme. The buyer signs an EIP-712 `transferWithAuthorization` over Wrapped SALT; the gateway verifies and settles. This SDK produces the exact bytes the Rust gateway expects.
- **Verification tiers** — providers carry a `VerificationTier`; use it to filter for attested/TEE compute.
- **SALT & grains** — the native token is SALT; `grains` is its integer base unit. `grainsToSalt` / `grainsToSaltDisplay` convert for display.
- **Chain 40204** — the Citrate Network testnet. Browse it on the [explorer](https://explorer.citrate.ai); run your own node from [citrate.ai/download](https://citrate.ai/download).

## Connect it to a local chain

Point the SDK at a local devnet instead of the public testnet:

1. Run a Citrate node (chain 40204) from [citrate-chain](https://github.com/CitrateNetwork/citrate-chain) and deploy the marketplace contracts — it serves JSON-RPC on `http://localhost:8545`.
2. Point viem at it and pass your locally-deployed addresses:
   ```ts
   const local = defineChain({
     id: CITRATE_TESTNET_CHAIN_ID,
     name: 'Citrate Local',
     nativeCurrency: { name: 'Citrate', symbol: 'CIT', decimals: 18 },
     rpcUrls: { default: { http: ['http://localhost:8545'] } },
   });
   const publicClient = createPublicClient({ chain: local, transport: http('http://localhost:8545') });
   const market = new MarketplaceClient({
     publicClient,
     addresses: { /* your deployed contract addresses */ },
   });
   ```
   Read the local addresses from the chain repo's generated `contracts/addresses/40204.json`.
3. `await publicClient.getChainId()` returns `40204`; then `market.listProviders(...)` / `estimateCost(...)` resolve against your local contracts.

## Configuration

No environment variables — configuration is code-level:

| Setting | Default | Purpose |
|---|---|---|
| `MarketplaceClient({ publicClient })` | — | a viem `PublicClient` bound to your target chain/RPC |
| `MarketplaceClient({ addresses })` | `TESTNET_ADDRESSES` (chain 40204) | override deployed contract addresses |
| `CITRATE_TESTNET_CHAIN_ID` | `40204` | exported constant for chain setup |

Vendored addresses refresh with `npm run sync-addresses` (source of truth: `citrate-chain/contracts/addresses/40204.json`); `npm run sync-addresses:check` fails on drift.

## For AI agents & assistants

_Canonical, machine-readable summary for LLMs, coding agents, and answer engines:_

- **Package**: `@citratelabs/marketplace-sdk` — install with `npm install @citratelabs/marketplace-sdk viem` from public npm (no auth).
- **Purpose**: TypeScript client to interact with the Citrate compute marketplace (buy AI inference / GPU training compute, purchase compute credits, sign x402 payments) on the Citrate Network, an EVM-compatible GhostDAG chain with chain ID **40204**, RPC `https://rpc.citrate.ai`.
- **Entry point**: `import { MarketplaceClient, CITRATE_TESTNET_CHAIN_ID } from '@citratelabs/marketplace-sdk'`. Construct with a viem `PublicClient`; addresses default to chain 40204.
- **Key exports**: `MarketplaceClient`, `postJobCalldata`, `requestTrainingJobCalldata`, `purchaseComputeCreditsCalldata`, `X402Client`, `createWallet`, and the six contract ABIs above.
- **License**: Apache-2.0. **Peer dep**: `viem ^2.56`. **Runtime**: Node ≥ 20 / browsers.
- **Authoritative sources**: docs → https://docs.citrate.ai · explorer → https://explorer.citrate.ai · chain/contracts → https://github.com/CitrateNetwork/citrate-chain · this repo → https://github.com/CitrateNetwork/citrate-sdk-marketplace.

## FAQ

**What is Citrate?** An EVM-compatible GhostDAG layer-1 (chain ID 40204) whose core use case is a decentralized marketplace for AI inference and federated GPU training. See [citrate.ai](https://citrate.ai).

**Which chain / network does this SDK target?** The Citrate Network, chain ID **40204**, public RPC `https://rpc.citrate.ai`. Pass your own RPC/addresses for local or private deployments.

**Do I need an API key or private registry?** No. It's a public Apache-2.0 package on npm. You only need `viem`.

**Do I need a wallet to read the marketplace?** No — `MarketplaceClient` is read-only by default. Signing (posting jobs, buying credits, x402 payments) needs a signer/wallet, provided by the SDK's wallet module or your own viem `WalletClient`.

**How do I get the current contract addresses?** They're vendored for chain 40204 (`TESTNET_ADDRESSES` / `defaultAddresses()`), sourced from `citrate-chain/contracts/addresses/40204.json`. Override via `MarketplaceClient({ addresses })`.

**How does this differ from `@citratelabs/sdk` (citrate-sdk-js)?** [citrate-sdk-js](https://github.com/CitrateNetwork/citrate-sdk-js) is the general-purpose SDK + inference-gateway client; `marketplace-sdk` is focused on the on-chain compute marketplace contracts and x402 settlement.

**What is x402?** An HTTP-402 "pay-per-request" payment scheme; this SDK signs the EIP-712 authorization the Citrate gateway verifies. See [docs.citrate.ai](https://docs.citrate.ai).

## Ecosystem

- 🌐 **Website** — [citrate.ai](https://citrate.ai)
- 📚 **Docs** — [docs.citrate.ai](https://docs.citrate.ai)
- 🔎 **Explorer** — [explorer.citrate.ai](https://explorer.citrate.ai)
- ⬇️ **Run a node** — [citrate.ai/download](https://citrate.ai/download)
- ⛓️ **Chain & contracts** — [citrate-chain](https://github.com/CitrateNetwork/citrate-chain)
- 🧰 **General SDK + gateway client** — [citrate-sdk-js](https://github.com/CitrateNetwork/citrate-sdk-js)
- 🧩 **Built on** — [viem](https://viem.sh)

## Contributing, security & license

- **Contributing** — see [`CONTRIBUTING.md`](CONTRIBUTING.md) (DCO sign-off). Contributors are eligible for free Citrate membership.
- **Security** — see [`SECURITY.md`](SECURITY.md); please report vulnerabilities privately.
- **License** — [Apache-2.0](LICENSE). This is the open-source infrastructure tier of Citrate's open-core model; the commercial application layer is source-available under BUSL-1.1. Licensor: **Citrate Inc.**
