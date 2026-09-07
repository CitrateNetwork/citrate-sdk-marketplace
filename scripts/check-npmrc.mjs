#!/usr/bin/env node
// Publish-integrity gate for .npmrc. Audit: SMK-B-009.
//
// Asserts two properties that, if violated, arm a dependency-confusion
// credential leak:
//   1. .npmrc names exactly ONE registry host (a scope mapped to a second
//      host means a future scoped dependency resolves elsewhere).
//   2. No two distinct registry hosts share the same `_authToken` variable
//      (the previous file bound npm.pkg.github.com's token to ${NODE_AUTH_TOKEN},
//      the same variable the publish workflow fills with the npmjs token).
//
// Exit non-zero on violation so it can gate `npm publish` in CI.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const npmrcPath = join(here, '..', '.npmrc');

let text;
try {
  text = readFileSync(npmrcPath, 'utf8');
} catch {
  // No .npmrc at all is fine — npm falls back to the default public registry.
  console.log('check-npmrc: no .npmrc present; OK');
  process.exit(0);
}

const lines = text
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));

const registryHosts = new Set();
/** host -> auth-token spec (e.g. "${NODE_AUTH_TOKEN}") */
const authTokenByHost = new Map();

for (const line of lines) {
  // `registry=<url>` or `@scope:registry=<url>`
  let m = line.match(/^(?:@[^:]+:)?registry\s*=\s*(\S+)$/);
  if (m) {
    try {
      registryHosts.add(new URL(m[1]).host);
    } catch {
      registryHosts.add(m[1]);
    }
    continue;
  }
  // `//host/path/:_authToken=<value>`
  m = line.match(/^\/\/([^/]+)\/.*:_authToken\s*=\s*(\S+)$/);
  if (m) {
    authTokenByHost.set(m[1], m[2]);
  }
}

const errors = [];
if (registryHosts.size > 1) {
  errors.push(
    `.npmrc names ${registryHosts.size} registry hosts (${[...registryHosts].join(
      ', ',
    )}); expected exactly one`,
  );
}

// Any single auth-token variable bound to two different hosts is the leak.
const hostsByToken = new Map();
for (const [host, token] of authTokenByHost) {
  if (!hostsByToken.has(token)) hostsByToken.set(token, []);
  hostsByToken.get(token).push(host);
}
for (const [token, hosts] of hostsByToken) {
  if (new Set(hosts).size > 1) {
    errors.push(
      `auth token ${token} is shared across registry hosts ${hosts.join(
        ', ',
      )} — a publish credential for one host would be sent to the other`,
    );
  }
}

if (errors.length) {
  for (const e of errors) console.error(`check-npmrc: ${e}`);
  process.exit(1);
}
console.log('check-npmrc: OK — single registry, no shared publish credential');
