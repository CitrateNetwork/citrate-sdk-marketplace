---
created: 2026-06-11
branch: audit/secrem02-x402-fail-closed
author: Fable 5 (Claude Code) subagent
sprint: SECREM-02-followup-remediation
repo: citrate-sdk-marketplace
baseline_test_count: 99
final_test_count: 138
baseline_commit: bfc107f01a875a3d64a3bfc87398137c24e965c4
audit_source: citrate-security/audits/2026-06-09-federation-followup-security-audit/per-repo/citrate-sdk-marketplace/REPORT.md
---

# SECREM-02 5.3 — Follow-up Remediation Log

All findings were re-verified open in current source before any change.
Red tests were written first and confirmed failing (30 failures across 4
new test files) against the unfixed code, then fixes landed, then each
new security check was mutated back out to confirm the tests catch it.

| Finding | Sev | Red test(s) | Fix (file) | Suite | Mutation | Disposition |
|---|---|---|---|---|---|---|
| FUA-SDK-MKT-01 — x402 spend policy fails open when `maxPayWei` omitted (`bigint > undefined` → false → uncapped auto-pay) | MED | `test/x402.failclosed.test.ts` "constructor fails CLOSED" (13 tests; 12 red pre-fix) | `src/x402.ts` — constructor now throws unless `maxPayWei` is a non-negative bigint, `chainId` a positive integer, `allowedTokens` a non-empty array of valid addresses; `allowedRecipients` (when given) same | 138/138 green | Check replaced with `if (false)` → 5 tests FAIL; restored | FIXED |
| FUA-SDK-MKT-02 — `publish.yml` `continue-on-error: true` on the test step lets a red suite publish | MED | `test/publish-workflow.test.ts` (2 tests; tripwire red pre-fix) | `.github/workflows/publish.yml` — `continue-on-error: true` deleted; warning comment added | 138/138 green | Key re-added under the Test step → tripwire FAILs; restored | FIXED |
| CITRATE_SDK_MARKETPLACE-2026-05-31-003 — `extractChallenge` key-presence-only validation; `valid_after`/`valid_before` never checked; malformed `amount` made `BigInt()` throw mid-`send` | MED | `test/x402.failclosed.test.ts` "-003 malformed challenge" (8 tests; 7 red pre-fix) | `src/x402.ts` — `extractChallenge` type/format-validates every field (addresses, bytes32 hex, decimal amount string, integer window, `valid_after < valid_before`); `send` additionally refuses already-expired windows. Malformed input returns the original 402 (fail closed, no throw) | 138/138 green | (a) amount validation removed → 1 FAIL; (b) expiry check removed → 1 FAIL; restored | FIXED |
| CITRATE_SDK_MARKETPLACE-2026-05-31-004 — `InjectedSigner` chain check connect-time only (TOCTOU) | MED | `test/wallet.toctou.test.ts` (5 tests; 4 red pre-fix) | `src/wallet/injected.ts` — new private `assertChainUnchanged()` re-queries `eth_chainId` and throws on mismatch; called at the top of `sign`, `signEip712`, `sendTransaction` (fail closed, incl. unparseable responses → NaN ≠ chainId) | 138/138 green | Mismatch branch neutered (`if (false)`) → 4 tests FAIL; restored | FIXED |
| CITRATE_SDK_MARKETPLACE-2026-05-31-005 — non-constant-time keystore MAC comparison (string `!==`) | LOW | `test/keystore.mac.test.ts` (11 tests; 7 red pre-fix) | `src/wallet/keystore.ts` — exported `constantTimeEqual()` (full-scan XOR-accumulate, no early exit); `decryptKeystore` decodes the stored mac and compares constant-time; malformed stored mac → same `invalid passphrase` error | 138/138 green | MAC check reverted to string `!==` → source tripwire FAILs; restored | FIXED |

## Notes

- **Baseline:** 99 tests / 7 files, all green at `bfc107f` (main, clean tree).
  **Final:** 138 tests / 11 files, all green. +39 tests, no test removed —
  ratchet satisfied (no CLAUDE.md / ratchet script exists in this repo; the
  count delta is recorded here instead).
- **Red-test confirmation:** pre-fix run of the four new files:
  `x402.failclosed` 18/21 failed, `wallet.toctou` 4/5 failed,
  `keystore.mac` 7/11 failed, `publish-workflow` 1/2 failed (30 red total).
  The handful of green-from-birth tests are guard tests (valid policy
  constructs, unchanged-chain still signs, round-trip still decrypts,
  test-step-ordering) that pin non-regression of the happy path.
- **Fixture update:** `test/x402.test.ts` `X402Client.send` challenge fixture
  moved from hardcoded 2024 epoch seconds to a `Date.now()`-relative window,
  because `send` now (correctly) refuses expired authorization windows. The
  `signChallenge` determinism tests keep their fixed historical values —
  `signChallenge` itself takes no policy (that residual is FUA-SDK-MKT-04,
  LOW, out of scope for this WP).
- **Constant-time caveat:** `constantTimeEqual` is constant-time at the JS
  source level (no data-dependent branch/early-exit); JIT behavior cannot be
  guaranteed from source, which is the accepted limit for a browser-resident
  TS keystore. Lengths compared are public (keccak256 MACs, 32 bytes).
- **Out of scope, intentionally untouched:** FUA-SDK-MKT-03 (registry drift —
  pre-audit WEB-5, in active remediation), FUA-SDK-MKT-04 (`signChallenge`
  policy re-assertion), FUA-SDK-MKT-05 (redirect/HTTPS hardening),
  FUA-SDK-MKT-06 (mutable action refs), -006 (passphrase/PBKDF2/zeroization).
- **Pre-existing issue (not introduced here):** `npm run lint` fails with
  `eslint: command not found` — eslint is referenced in `package.json` but is
  not a devDependency. Typecheck (`tsc --noEmit`) passes.
- **Mutation protocol:** every mutation was applied to the working copy,
  the targeted new test file run (FAIL confirmed), and the file restored
  byte-identical from a pre-mutation backup (verified with `diff`), followed
  by a final full green run.
