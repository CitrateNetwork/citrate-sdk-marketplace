// The .npmrc publish-integrity gate (scripts/check-npmrc.mjs) runs in CI and in
// the publish workflow. Pin both halves: the committed .npmrc passes it, and
// the gate itself rejects a second registry host or an auth variable shared
// across hosts. Fixture runs use a private temp copy of the script, so the
// repo's own .npmrc is never modified.

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, test } from 'vitest';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(repo, 'scripts', 'check-npmrc.mjs');
const sandbox = mkdtempSync(join(tmpdir(), 'npmrc-gate-'));

afterAll(() => {
  if (sandbox.startsWith(tmpdir()) && sandbox.includes('npmrc-gate-')) {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

function runGate(npmrc: string): { status: number | null; out: string } {
  const dir = mkdtempSync(join(sandbox, 'case-'));
  mkdirSync(join(dir, 'scripts'));
  copyFileSync(script, join(dir, 'scripts', 'check-npmrc.mjs'));
  writeFileSync(join(dir, '.npmrc'), npmrc);
  const r = spawnSync(process.execPath, [join(dir, 'scripts', 'check-npmrc.mjs')], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '' },
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

describe('.npmrc publish-integrity gate', () => {
  test('the committed .npmrc passes the gate', () => {
    // Throws (non-zero exit) if the gate rejects the repo's file.
    const out = execFileSync(process.execPath, [script], { encoding: 'utf8' });
    expect(out).toMatch(/OK/);
  });

  test('the committed .npmrc names only the public npm registry', () => {
    const lines = readFileSync(join(repo, '.npmrc'), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    const registries = lines.filter((l) => /registry\s*=/.test(l));
    expect(registries).toEqual(['registry=https://registry.npmjs.org/']);
    expect(lines.some((l) => l.includes('_authToken'))).toBe(false);
  });

  test('control: a single-registry file passes', () => {
    const r = runGate('registry=https://registry.npmjs.org/\nprovenance=true\n');
    expect(r.status).toBe(0);
  });

  test('a scope mapped to a second registry host is rejected', () => {
    const r = runGate(
      'registry=https://registry.npmjs.org/\n@scope:registry=https://npm.pkg.github.com\n',
    );
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/2 registry hosts/);
  });

  test('one auth variable bound to two hosts is rejected', () => {
    const r = runGate(
      [
        'registry=https://registry.npmjs.org/',
        '//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}',
        '//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}',
        '',
      ].join('\n'),
    );
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/shared across registry hosts/);
  });
});
