#!/usr/bin/env bash
# LOCAL address-drift check — no GitHub Actions, no token required.
#
# Verifies this SDK's vendored src/generated/addresses.json still matches the
# canonical citrate-chain source of truth (contracts/addresses/40204.json). Run
# before pushing/merging and after every re-roll while org CI is down.
#
#   bash scripts/check-address-drift.sh
#
# Exit 1 on drift. Local mirror of the `address-drift` job in
# .github/workflows/ci.yml (CL-C2 / SW-179).
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
CANONICAL="$HERE/../citrate-chain/contracts/addresses/40204.json"

if [ ! -f "$CANONICAL" ]; then
  echo "[address-drift] citrate-chain sibling not found at $CANONICAL"
  echo "  Ensure citrate-chain is a sibling of this repo under citrate-labs/."
  exit 2
fi

npm run --silent sync-addresses:check
