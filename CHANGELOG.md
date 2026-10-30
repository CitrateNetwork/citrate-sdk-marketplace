# Changelog

All notable changes to `@citratelabs/marketplace-sdk` are documented here. This project follows
[Semantic Versioning](https://semver.org/); while it is 0.x, a minor release may carry breaking
changes.

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
