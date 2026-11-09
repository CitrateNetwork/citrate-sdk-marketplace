// SECREM-02 5.3 — FUA-SDK-MKT-02.
//
// The publish workflow carried `continue-on-error: true` on the test
// step, so a tag push shipped the package to the registry even with
// the audit-mandated security tripwires red. The security tests only
// have teeth if a failure blocks publish — assert the escape hatch
// stays gone.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const workflow = readFileSync(
  join(here, '..', '.github', 'workflows', 'publish.yml'),
  'utf8',
);

describe('publish workflow gates on tests (FUA-SDK-MKT-02)', () => {
  test('TRIPWIRE: no continue-on-error key anywhere in publish.yml', () => {
    // Match the YAML key (any value), not prose in comments warning
    // against it.
    expect(workflow).not.toMatch(/^\s*continue-on-error\s*:/m);
  });

  test('the test step still runs before publish', () => {
    const testIdx = workflow.indexOf('npm test');
    const publishIdx = workflow.indexOf('npm publish');
    expect(testIdx).toBeGreaterThan(-1);
    expect(publishIdx).toBeGreaterThan(-1);
    expect(testIdx).toBeLessThan(publishIdx);
  });
});

// The v0.2.0 tag push reached `npm publish` and npmjs answered E404 on the PUT:
// the stored NPM_TOKEN no longer had publish rights, so 0.2.0 never shipped.
// The org publishes @citratelabs/sdk through npm trusted publishing (OIDC,
// PBA-L6-004); this workflow moves to the same path. No long-lived npm token
// lives in GitHub, npm mints a per-run credential, and provenance is signed.
describe('publish workflow uses npm trusted publishing (OIDC)', () => {
  const lines = workflow
    .split('\n')
    .filter((l) => !l.trim().startsWith('#'))
    .join('\n');

  test('no stored npm token is read or required', () => {
    expect(lines).not.toMatch(/secrets\.NPM_TOKEN/);
    expect(lines).not.toMatch(/NODE_AUTH_TOKEN/);
  });

  test('setup-node does not write a registry-url token placeholder', () => {
    expect(lines).not.toMatch(/registry-url\s*:/);
  });

  test('the publish job can mint an OIDC token', () => {
    expect(lines).toMatch(/^\s*id-token\s*:\s*write\s*$/m);
  });

  test('npm is new enough for trusted publishing (>= 11.5.1) before publish', () => {
    const m = lines.match(/npm install -g npm@(\d+)\.(\d+)\.(\d+)/);
    expect(m).not.toBeNull();
    const [maj, min, pat] = (m as RegExpMatchArray).slice(1).map(Number);
    const ok = maj > 11 || (maj === 11 && (min > 5 || (min === 5 && pat >= 1)));
    expect(ok).toBe(true);
    expect(lines.indexOf('npm install -g npm@')).toBeLessThan(lines.indexOf('npm publish'));
  });

  test('publish asks for provenance explicitly', () => {
    expect(lines).toMatch(/npm publish[^\n]*--provenance/);
  });

  test('a re-run on an already-published version skips instead of failing', () => {
    const viewIdx = lines.indexOf('npm view "$NAME@$VER" version');
    expect(viewIdx).toBeGreaterThan(-1);
    expect(viewIdx).toBeLessThan(lines.indexOf('npm publish'));
  });

  test('the tag/version match and dist-tag allowlist still gate publish', () => {
    expect(lines).toMatch(/TAG_VERSION="\$\{GITHUB_REF#refs\/tags\/v\}"/);
    expect(lines).toMatch(/\^\(latest\|next\|beta\|rc\)\$/);
    expect(lines).toMatch(/DIST_TAG:\s*\$\{\{\s*github\.event\.inputs\.tag/);
    expect(lines).not.toMatch(/run:[^\n]*\$\{\{\s*github\.event\.inputs/);
  });
});
