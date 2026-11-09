# Changelog

All notable changes to `@citratelabs/marketplace-sdk` are documented here. This project follows
[Semantic Versioning](https://semver.org/); while it is 0.x, a minor release may carry breaking
changes.

## [0.2.1] - 2026-11-09 — trusted publishing; 0.2.0 never reached npm

No API or address change from 0.2.0. 0.2.0 was tagged on 2026-10-30, but its publish run failed
(npmjs answered E404 on the PUT: the stored `NPM_TOKEN` no longer had publish rights), so npm
still serves 0.1.1 with the r1005 book. r1006 is now the network rpc.citrate.ai serves (block 0
`0xa3651a27…6cdd4`), so 0.2.1 is the release that ships the r1006 book and the network guard.

### Changed

- `.github/workflows/publish.yml` publishes through npm trusted publishing (OIDC), the same path
  as `@citratelabs/sdk` in citrate-sdk-js `release.yml` (PBA-L6-004). No npm token is read; the
  job mints a per-run credential with `id-token: write`, upgrades npm to 11.6.2 (trusted
  publishing needs >= 11.5.1), runs on Node 22, and passes `--provenance`. `setup-node` no longer
  takes `registry-url`, so no `_authToken` placeholder is written. A re-run on a version already on
  the registry skips the publish. The tests-before-publish order, the tag/version match and the
  dist-tag allowlist (SMK-B-001) are unchanged.

### Tests

- `test/publish-workflow.test.ts`: 7 new tests pin the trusted-publishing path (no `NPM_TOKEN`
  or `NODE_AUTH_TOKEN`, no `registry-url`, `id-token: write`, npm >= 11.5.1 before publish,
  `--provenance`, skip-if-published, the version and dist-tag gates). 189 -> 196.

### Docs

- README: contract deployment and CitrateScan verification live in `@citratelabs/sdk` >= 0.4.0
  (`deployAndVerify`, `verifyContract`) and `citrate-labs-sdk` >= 0.8.0 on PyPI
  (`deploy_and_verify`, `verify_contract`). This package does not deploy contracts: the
  marketplace contracts it binds are in r1006 block 0.

## [0.2.0] - 2026-10-27 — r1006 address book and a genesis guard

Held for the r1006 public cutover: publish only after rpc.citrate.ai serves r1006.

### Changed

- Address book follows the r1006 network of 40204 (genesis block
  `0xa3651a272fe411948cbb4cf7cca4cee44be4248d32ab4376cea7636821c6cdd4`).
  `src/generated/addresses.json` is re-synced with `npm run sync-addresses` from citrate-chain
  `contracts/addresses/r1006/40204.json` (final since a857443e; every contract is in block 0); no
  hand edits. The six marketplace contracts move to their r1006 addresses
  (`ComputeMarketplace 0x2fec2ac1…`, `InferenceRouter 0x165b811c…`, `ComputePricingOracle
  0xc3b66ef2…`, `BulkComputeGateway 0x37a9dec7…`, `ComputePoolTraining 0x736034d7…`,
  `ModelRegistry 0x4c367f77…`). Contracts not in r1006 block 0 (`LiquidStakingPool`,
  `CitAgentTimelock`, the DPF and tenant/governance-kit registries) are no longer in the
  vendored book.
- `scripts/sync-addresses.mjs` reads the r1006 book and also writes
  `src/generated/network.json` with the genesis hash parsed from `R1006_GENESIS` in citrate-chain
  `core/consensus/src/hardening.rs`; `--check` covers both files. `CITRATE_CHAIN_DIR` points it
  at another checkout. The CI `address-drift` job sparse-checks-out those two files.

### Added

- Network guard. r1005 and r1006 share chain id 40204, so the chain id cannot tell them apart.
  With the default address book, `MarketplaceClient` reads block 0 before its first contract
  read (`listProviders`, `estimateCost`, `getCreditBalance`, `fetchCreditsLogs`,
  `minPurchaseUsd`, `getProviderProfile`) and throws `MarketplaceError` code `wrong_network`
  unless the hash is `EXPECTED_GENESIS_HASH`. `market.verifyNetwork()` runs the check up front.
  `expectedGenesisHash` overrides the hash (and turns the check on for caller-supplied
  `addresses`); `null` turns it off.
- `EXPECTED_GENESIS_HASH` export.

### Tests

- `test/r1006-network.test.ts` (15 tests): the r1006 book, no r1005 address, and the guard on
  every book read (wrong genesis, missing or unreadable block 0, failure not cached, opt-out,
  override).
- The `client.test.ts` mock `PublicClient` answers block 0 with the vendored genesis.

### Docs

- README: the r1006 book, the network guard, and "Tokenomics are not yet determined; see
  docs.citrate.ai."
