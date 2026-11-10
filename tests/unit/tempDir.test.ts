import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { useTempDir } from './tempDir';

describe('useTempDir', () => {
  const dir = useTempDir();
  const seen: string[] = [];

  it('gives each test an empty, writable folder', async () => {
    seen.push(dir.path);
    expect(await fs.readdir(dir.path)).toEqual([]);
    await fs.writeFile(path.join(dir.path, 'campaign.json'), '{}');
    expect(await fs.readdir(dir.path)).toEqual(['campaign.json']);
  });

  it('gives the next test a different folder and removes the previous one', async () => {
    seen.push(dir.path);
    expect(seen[1]).not.toBe(seen[0]);
    await expect(fs.access(seen[0])).rejects.toThrow();
  });

  afterAll(async () => {
    await expect(fs.access(seen[1])).rejects.toThrow();
  });
});
