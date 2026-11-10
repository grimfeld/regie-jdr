import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach } from 'vitest';

/**
 * Gives every test in the enclosing suite its own empty temporary folder,
 * removed after the test. Read `.path` inside the test, not at collection time.
 */
export function useTempDir(): { readonly path: string } {
  let current = '';
  beforeEach(async () => {
    current = await fs.mkdtemp(path.join(os.tmpdir(), 'regie-unit-'));
  });
  afterEach(async () => {
    await fs.rm(current, { recursive: true, force: true });
  });
  return {
    get path() {
      if (!current) throw new Error('useTempDir: path is only available inside a test');
      return current;
    },
  };
}
