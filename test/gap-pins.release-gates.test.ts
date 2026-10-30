// Pins for the release path and shipped defaults:
//   - every `uses:` in every workflow is pinned to a full commit SHA;
//   - publish.yml keeps its .npmrc gate and its blocking production audit,
//     both ahead of the publish step and neither neutralised;
//   - the shipped testnet address book carries no zero-address placeholder
//     that a value-bearing calldata builder could be pointed at;
//   - source headers name the package that is actually published.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

import { defaultAddresses, TESTNET_ADDRESSES } from '../src/contracts.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wfDir = join(root, '.github', 'workflows');
const workflows = readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f));
const publish = readFileSync(join(wfDir, 'publish.yml'), 'utf8');

/// Split publish.yml's steps on `- name:` / `- uses:` markers.
function steps(yml: string): string[] {
  return yml.split(/\n(?=\s*- (?:name|uses):)/);
}

describe('workflow action pinning', () => {
  test('there are workflows to check', () => {
    expect(workflows.length).toBeGreaterThan(0);
  });

  test.each(workflows)('TRIPWIRE: every uses: in %s is a 40-hex commit SHA', (f) => {
    const yml = readFileSync(join(wfDir, f), 'utf8');
    const refs = [...yml.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gm)].map((m) => m[1]);
    for (const r of refs) {
      if (r.startsWith('./')) continue;
      expect(r, `${f}: ${r}`).toMatch(/@[0-9a-f]{40}$/);
    }
  });
});

describe('publish.yml pre-publish gates', () => {
  const s = steps(publish);
  const idx = (re: RegExp) => s.findIndex((x) => re.test(x));
  const publishIdx = idx(/npm publish/);

  test('the publish step exists', () => {
    expect(publishIdx).toBeGreaterThan(-1);
  });

  test('TRIPWIRE: the .npmrc gate runs before publish', () => {
    const i = idx(/node scripts\/check-npmrc\.mjs/);
    expect(i).toBeGreaterThan(-1);
    expect(i).toBeLessThan(publishIdx);
  });

  test('TRIPWIRE: the production audit runs before publish and is blocking', () => {
    const i = idx(/npm audit --omit=dev --audit-level=high/);
    expect(i).toBeGreaterThan(-1);
    expect(i).toBeLessThan(publishIdx);
    expect(s[i]).not.toMatch(/\|\|\s*(true|:|exit 0)/);
    expect(s[i]).not.toMatch(/continue-on-error/);
  });

  test('TRIPWIRE: the .npmrc gate step is not neutralised', () => {
    const i = idx(/node scripts\/check-npmrc\.mjs/);
    expect(s[i]).not.toMatch(/\|\|\s*(true|:|exit 0)/);
    expect(s[i]).not.toMatch(/\bif:/);
  });
});

describe('shipped address book', () => {
  const ZERO = /^0x0{40}$/i;

  test.each(Object.entries(TESTNET_ADDRESSES))('%s is a real 20-byte address, not the zero placeholder', (_k, v) => {
    expect(v).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(v).not.toMatch(ZERO);
  });

  test('defaultAddresses() returns the same non-zero book', () => {
    for (const v of Object.values(defaultAddresses())) expect(v).not.toMatch(ZERO);
  });
});

describe('package naming in source headers', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name: string };

  test('src/index.ts names the published package', () => {
    const head = readFileSync(join(root, 'src', 'index.ts'), 'utf8').split('\n')[0];
    expect(head).toContain(pkg.name);
  });

  test('no source file names the retired @citrate-ai scope', () => {
    const walk = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(d, e.name)) : /\.ts$/.test(e.name) ? [join(d, e.name)] : [],
      );
    const hits = walk(join(root, 'src')).filter((f) => readFileSync(f, 'utf8').includes('@citrate-ai/'));
    expect(hits).toEqual([]);
  });
});
