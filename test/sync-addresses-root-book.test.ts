// The vendored book must follow citrate-chain's ROOT book (contracts/addresses/<chain id>.json,
// the live network) and that book's own genesisHash, not a per-release book. A sync that reads
// contracts/addresses/r1006/40204.json keeps matching r1006 after the chain moves to r1007, so
// its drift gate stays green at the cut (fed#552, ADDRESS_PROPAGATION.md gap 3).
//
// These tests run scripts/sync-addresses.mjs --check against a temp copy of the chain inputs.
// Nothing reaches the network.

import { describe, expect, test } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import network from '../src/generated/network.json';
import canonical from '../src/generated/addresses.json';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHAIN = process.env.CITRATE_CHAIN_DIR ?? resolve(ROOT, '..', 'citrate-chain');
const ID = canonical.chainId;
const ROOT_BOOK = `contracts/addresses/${ID}.json`;
const R1006_BOOK = `contracts/addresses/r1006/${ID}.json`;
const HARDENING = 'core/consensus/src/hardening.rs';
const haveChain = existsSync(join(CHAIN, ROOT_BOOK)) && existsSync(join(CHAIN, R1006_BOOK));

function fakeChain(rootBook: string, hardening?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'mkt-chain-'));
  mkdirSync(join(dir, 'contracts/addresses/r1006'), { recursive: true });
  mkdirSync(join(dir, 'core/consensus/src'), { recursive: true });
  copyFileSync(join(CHAIN, R1006_BOOK), join(dir, R1006_BOOK));
  writeFileSync(join(dir, HARDENING), hardening ?? readFileSync(join(CHAIN, HARDENING), 'utf8'));
  writeFileSync(join(dir, ROOT_BOOK), rootBook);
  return dir;
}

const check = (chainDir: string) =>
  spawnSync(process.execPath, ['scripts/sync-addresses.mjs', '--check'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, CITRATE_CHAIN_DIR: chainDir },
  });

describe('the vendored book is the root book', () => {
  test('network.json names the root book and carries its genesisHash', () => {
    expect(network.book).toBe(`citrate-chain/${ROOT_BOOK}`);
    expect(network.genesisHash).toBe((canonical as { genesisHash?: string }).genesisHash);
    expect(network.genesisSource).toMatch(/^citrate-chain\/core\/consensus\/src\/hardening\.rs R\d+_GENESIS$/);
  });

  test.skipIf(!haveChain)('--check fails when only the root book moved (the r1006 copy is unchanged)', () => {
    const real = readFileSync(join(CHAIN, ROOT_BOOK), 'utf8');
    const moved = JSON.parse(real);
    moved.contracts.ComputeMarketplace = '0x' + '1'.repeat(40);
    const r = check(fakeChain(JSON.stringify(moved, null, 2) + '\n'));
    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(r.stderr).toMatch(/OUT OF SYNC/);
    expect(check(fakeChain(real)).status).toBe(0);
  });

  test.skipIf(!haveChain)('refuses a root book whose genesisHash no R<n>_GENESIS constant confirms', () => {
    const book = JSON.parse(readFileSync(join(CHAIN, ROOT_BOOK), 'utf8'));
    book.genesisHash = '0x' + '9'.repeat(64);
    const r = check(fakeChain(JSON.stringify(book, null, 2) + '\n'));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/no R<n>_GENESIS constant/);
  });

  test.skipIf(!haveChain)('a new genesis is followed with no code change (fake R1007 constant)', () => {
    const book = JSON.parse(readFileSync(join(CHAIN, ROOT_BOOK), 'utf8'));
    book.genesisHash = '0x' + '7'.repeat(64);
    const rs = readFileSync(join(CHAIN, HARDENING), 'utf8') + `\npub const R1007_GENESIS: [u8; 32] =\n    hex32("${'7'.repeat(64)}");\n`;
    const r = check(fakeChain(JSON.stringify(book, null, 2) + '\n', rs));
    // The committed copy is r1006, so the check must fail on drift, not on a refused genesis.
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/OUT OF SYNC/);
    expect(r.stderr).not.toMatch(/R<n>_GENESIS/);
  });
});
