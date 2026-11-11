#!/usr/bin/env node
/**
 * Sync the canonical Citrate contract-address table from citrate-chain into
 * this repo's committed vendored copy at `src/generated/addresses.json`, and
 * the genesis block hash of the network that book describes into
 * `src/generated/network.json`.
 *
 * Sources of truth (citrate-chain, the sibling checkout or CITRATE_CHAIN_DIR):
 *   contracts/addresses/<chain id>.json    the ROOT book: the live network, block-0 and
 *                                          post-genesis contracts (scripts/addresses/
 *                                          emit_root_book.py; npm @citratelabs/chain-config).
 *                                          Its genesisHash is the network's block-0 hash.
 *   core/consensus/src/hardening.rs        the R<n>_GENESIS constants: exactly one must equal
 *                                          the book's genesisHash. No release is named here,
 *                                          so a new genesis turns --check red by itself.
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
// The chain id is the vendored book's own (src/generated/addresses.json), so a sync can never
// silently switch chains: a book for another chain id is refused below.
const CHAIN_ID = JSON.parse(readFileSync(resolve(REPO_ROOT, "src", "generated", "addresses.json"), "utf8")).chainId;
const BOOK_RELPATH = `contracts/addresses/${CHAIN_ID}.json`;
const GENESIS_RELPATH = "core/consensus/src/hardening.rs";
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
if (canonical.chainId !== CHAIN_ID) {
  console.error(
    `[sync-addresses] canonical chainId is ${canonical.chainId}, expected ${CHAIN_ID}`,
  );
  process.exit(1);
}
if (typeof canonical.genesisHash !== "string" || !/^0x[0-9a-f]{64}$/.test(canonical.genesisHash)) {
  console.error(`[sync-addresses] the root book has no 32-byte lowercase genesisHash (${canonical.genesisHash})`);
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

// The book's genesisHash must equal exactly one R<n>_GENESIS constant in the Rust source.
const constants = [
  ...readFileSync(GENESIS_RS, "utf8").matchAll(
    /pub const (R\d+_GENESIS)\s*:\s*\[u8;\s*32\]\s*=\s*hex32\(\s*"([0-9a-fA-F]*)"\s*\)/g,
  ),
].map((m) => ({ name: m[1], hash: `0x${m[2].toLowerCase()}`, ok: /^[0-9a-fA-F]{64}$/.test(m[2]) }));
const bad = constants.find((c) => !c.ok);
if (bad) {
  console.error(`[sync-addresses] ${bad.name} in ${GENESIS_RELPATH} is not 32 bytes`);
  process.exit(1);
}
const confirming = constants.filter((c) => c.hash === canonical.genesisHash);
if (confirming.length !== 1) {
  console.error(
    `[sync-addresses] the root book's genesisHash ${canonical.genesisHash} matches ` +
      `${confirming.length === 0 ? "no R<n>_GENESIS constant" : confirming.map((c) => c.name).join(", ")} in ${GENESIS_RELPATH}`,
  );
  process.exit(1);
}
const network = {
  chainId: canonical.chainId,
  genesisHash: canonical.genesisHash,
  book: `citrate-chain/${BOOK_RELPATH}`,
  genesisSource: `citrate-chain/${GENESIS_RELPATH} ${confirming[0].name}`,
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
