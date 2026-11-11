import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPartialFiles } from '../../core/partialFiles';
import { openStorage } from '../../core/storage';
import { useTempDir } from './tempDir';

const UUID = '0b6f2c1e-4d5a-4e8b-9f10-1a2b3c4d5e6f';

async function exists(file: string): Promise<boolean> {
  return fs.lstat(file).then(
    () => true,
    () => false,
  );
}

describe('partial files the app writes', () => {
  const dir = useTempDir();

  function setup() {
    const storage = openStorage(path.join(dir.path, 'data'));
    const out = path.join(dir.path, 'out');
    return {
      storage,
      out,
      partials: () =>
        createPartialFiles(storage.documents, path.join(storage.root, 'partials.json')),
    };
  }

  it('deletes at the next start the ones a killed app left, and only those', async () => {
    const { out, partials } = setup();
    await fs.mkdir(out, { recursive: true });
    const left = path.join(out, `Les Ombres.zip.${UUID}.partial`);
    const finished = path.join(out, `Warhammer.zip.${UUID.replace('0b', '1c')}.partial`);
    const before = partials();
    await before.add(left);
    await fs.writeFile(left, 'half a zip');
    await before.add(finished);
    await fs.writeFile(finished, 'whole zip');
    await before.remove(finished);
    // Not the app's: a file of the same shape it never recorded.
    const foreign = path.join(out, `Autre.zip.${UUID.replace('0b', '2d')}.partial`);
    await fs.writeFile(foreign, 'someone else’s');

    // The app was killed; it starts again.
    await partials().clear();

    expect(await exists(left)).toBe(false);
    expect(await exists(finished)).toBe(true);
    expect(await exists(foreign)).toBe(true);
    // Forgotten once cleared: a second start has nothing to do.
    await fs.writeFile(left, 'a new file of that name');
    await partials().clear();
    expect(await exists(left)).toBe(true);
  });

  it('never deletes a recorded path that is not a partial file of the app', async () => {
    const { out, partials, storage } = setup();
    await fs.mkdir(path.join(out, `folder.zip.${UUID}.partial`), { recursive: true });
    const notPartial = path.join(out, 'Les Ombres.zip');
    await fs.writeFile(notPartial, 'a real Export');
    const recorded = [
      notPartial,
      path.join(out, `folder.zip.${UUID}.partial`),
      `relative.zip.${UUID}.partial`,
    ];
    await fs.mkdir(storage.root, { recursive: true });
    await fs.writeFile(
      path.join(storage.root, 'partials.json'),
      JSON.stringify({ schemaVersion: 1, files: recorded }),
    );

    await partials().clear();

    expect(await exists(notPartial)).toBe(true);
    expect(await exists(path.join(out, `folder.zip.${UUID}.partial`))).toBe(true);
  });

  it('forgets a recorded file already gone', async () => {
    const { out, partials, storage } = setup();
    const gone = path.join(out, `Gone.zip.${UUID}.partial`);
    await partials().add(gone);

    await partials().clear();

    const saved = JSON.parse(
      await fs.readFile(path.join(storage.root, 'partials.json'), 'utf8'),
    ) as { files: string[] };
    expect(saved.files).toEqual([]);
  });
});
