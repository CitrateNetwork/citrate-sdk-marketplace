#!/usr/bin/env bash
# LOCAL address-drift check — no GitHub Actions, no token required.
#
# Verifies this SDK's vendored src/generated/addresses.json and network.json
# still match the canonical citrate-chain sources of truth (the root book
# contracts/addresses/<chain id>.json and the R<n>_GENESIS constant in
# core/consensus/src/hardening.rs that confirms its genesisHash). Run before pushing/merging and after every
# re-roll while org CI is down. CITRATE_CHAIN_DIR points at another checkout.
#
#   bash scripts/check-address-drift.sh
#
# Exit 1 on drift. Local mirror of the `address-drift` job in
# .github/workflows/ci.yml (CL-C2 / SW-179).
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
CHAIN_DIR="${CITRATE_CHAIN_DIR:-$HERE/../citrate-chain}"
cd "$HERE"
ID="$(node -p 'require("./src/generated/addresses.json").chainId')"
for f in "$CHAIN_DIR/contracts/addresses/$ID.json" "$CHAIN_DIR/core/consensus/src/hardening.rs"; do
  if [ ! -f "$f" ]; then
    echo "[address-drift] citrate-chain input not found at $f"
    echo "  Ensure citrate-chain is a sibling of this repo under citrate-labs/ (or set CITRATE_CHAIN_DIR)."
    exit 2
  fi
done

npm run --silent sync-addresses:check
