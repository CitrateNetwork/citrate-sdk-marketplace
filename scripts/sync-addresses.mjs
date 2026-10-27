#!/usr/bin/env node
/**
 * Sync the canonical Citrate contract-address table from citrate-chain into
 * this repo's committed vendored copy at `src/generated/addresses.json`, and
 * the genesis block hash of the network that book describes into
 * `src/generated/network.json`.
 *
 * Sources of truth (citrate-chain, the sibling checkout or CITRATE_CHAIN_DIR):
 *   contracts/addresses/r1006/40204.json   the r1006 book (every contract is in
 *                                          block 0; scripts/genesis/r1006/emit_book.py)
 *   core/consensus/src/hardening.rs        `R1006_GENESIS`, the r1006 block-0 hash
 *
 * Run via `pnpm sync-addresses`. Diffs the result against the committed copy
 * and exits non-zero if anything mismatches when invoked with `--check` (CI
 * gate). Without `--check`, overwrites and prints what changed.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
// citrate-chain is a sibling of this repo under citrate-labs/ (or CITRATE_CHAIN_DIR).
const CHAIN_DIR = process.env.CITRATE_CHAIN_DIR
  ? resolve(process.env.CITRATE_CHAIN_DIR)
  : resolve(REPO_ROOT, "..", "citrate-chain");
const BOOK_RELPATH = "contracts/addresses/r1006/40204.json";
const GENESIS_RELPATH = "core/consensus/src/hardening.rs";
const GENESIS_CONSTANT = "R1006_GENESIS";
const CANONICAL = resolve(CHAIN_DIR, BOOK_RELPATH);
const GENESIS_RS = resolve(CHAIN_DIR, GENESIS_RELPATH);
const VENDORED = resolve(REPO_ROOT, "src", "generated", "addresses.json");
const VENDORED_NETWORK = resolve(REPO_ROOT, "src", "generated", "network.json");

const CHECK_MODE = process.argv.includes("--check");

for (const p of [CANONICAL, GENESIS_RS]) {
  if (!existsSync(p)) {
    console.error(
      `[sync-addresses] canonical input not found at ${p}\n` +
        "  Make sure citrate-chain is a sibling of this repo under citrate-labs/ (or set CITRATE_CHAIN_DIR).",
    );
    process.exit(1);
  }
}

const canonical = JSON.parse(readFileSync(CANONICAL, "utf8"));

// Minimum-shape gate: a malformed canonical must NOT pollute the vendored
// copy. Reject anything missing `chainId`, `contracts`, or `aaStack`.
const requiredTop = ["chainId", "contracts", "aaStack"];
for (const k of requiredTop) {
  if (!(k in canonical)) {
    console.error(`[sync-addresses] canonical is missing required key: ${k}`);
    process.exit(1);
  }
}
if (canonical.chainId !== 40204) {
  console.error(
    `[sync-addresses] canonical chainId is ${canonical.chainId}, expected 40204`,
  );
  process.exit(1);
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const allAddresses = [
  ...Object.entries(canonical.contracts ?? {}),
  ...Object.entries(canonical.aaStack ?? {}),
  ...Object.entries(canonical.genesis ?? {}),
];
for (const [name, addr] of allAddresses) {
  if (typeof addr !== "string" || !ADDRESS_RE.test(addr)) {
    console.error(
      `[sync-addresses] address for ${name} is not a 20-byte hex: ${addr}`,
    );
    process.exit(1);
  }
}

// Genesis block hash, parsed from the Rust source (exactly one 32-byte match).
const genesisRe = new RegExp(
  `pub const ${GENESIS_CONSTANT}\\s*:\\s*\\[u8;\\s*32\\]\\s*=\\s*hex32\\(\\s*"([0-9a-fA-F]*)"\\s*\\)`,
  "g",
);
const genesisHits = [...readFileSync(GENESIS_RS, "utf8").matchAll(genesisRe)];
if (genesisHits.length !== 1 || !/^[0-9a-fA-F]{64}$/.test(genesisHits[0][1])) {
  console.error(
    `[sync-addresses] expected exactly one 32-byte ${GENESIS_CONSTANT} in ${GENESIS_RELPATH}, found ${genesisHits.length}`,
  );
  process.exit(1);
}
const network = {
  chainId: canonical.chainId,
  genesisHash: `0x${genesisHits[0][1].toLowerCase()}`,
  book: `citrate-chain/${BOOK_RELPATH}`,
  genesisSource: `citrate-chain/${GENESIS_RELPATH} ${GENESIS_CONSTANT}`,
};

const serialized = JSON.stringify(canonical, null, 2) + "\n";
const serializedNetwork = JSON.stringify(network, null, 2) + "\n";

if (CHECK_MODE) {
  for (const [p, want] of [[VENDORED, serialized], [VENDORED_NETWORK, serializedNetwork]]) {
    if (!existsSync(p)) {
      console.error(`[sync-addresses] no vendored copy at ${p}`);
      process.exit(1);
    }
    if (readFileSync(p, "utf8") !== want) {
      console.error(
        `[sync-addresses] ${p} is OUT OF SYNC with canonical. Run \`npm run sync-addresses\` and commit the diff.`,
      );
      process.exit(1);
    }
  }
  console.log("[sync-addresses] vendored copy matches canonical ✓");
  process.exit(0);
}

writeFileSync(VENDORED, serialized);
writeFileSync(VENDORED_NETWORK, serializedNetwork);
console.log(`[sync-addresses] wrote ${VENDORED} and ${VENDORED_NETWORK} (genesis ${network.genesisHash})`);
console.log(
  `  contracts: ${Object.keys(canonical.contracts ?? {}).length}` +
    `, aaStack: ${Object.keys(canonical.aaStack ?? {}).length}` +
    `, genesis: ${Object.keys(canonical.genesis ?? {}).length}`,
);
