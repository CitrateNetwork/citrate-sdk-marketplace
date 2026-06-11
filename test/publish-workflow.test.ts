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
