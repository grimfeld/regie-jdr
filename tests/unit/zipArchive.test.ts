import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeZipArchive } from '../../electron/zipArchive';
import { readZipEntries } from '../zipEntries';
import { useTempDir } from './tempDir';

describe('writeZipArchive', () => {
  const dir = useTempDir();

  async function mediaFile(name: string, size: number) {
    const file = path.join(dir.path, name);
    await fs.writeFile(file, Buffer.alloc(size, 7));
    return file;
  }

  it('writes bytes and files in order, deflating or storing each as asked', async () => {
    const image = await mediaFile('image.png', 70_000);
    const target = path.join(dir.path, 'out', 'Export.zip');
    await fs.mkdir(path.dirname(target));
    const bytes: number[] = [];

    await writeZipArchive(target)(
      [
        { path: 'campaign.json', compress: true, source: { data: Buffer.from('{"a":1}') } },
        { path: 'media/image.png', compress: false, source: { file: image, size: 70_000 } },
      ],
      { onBytes: (count) => bytes.push(count) },
    );

    const entries = readZipEntries(await fs.readFile(target));
    expect(entries.map(({ name, method }) => [name, method])).toEqual([
      ['campaign.json', 8],
      ['media/image.png', 0],
    ]);
    expect(entries[0].content.toString()).toBe('{"a":1}');
    expect(entries[1].content.equals(Buffer.alloc(70_000, 7))).toBe(true);
    expect(bytes.reduce((sum, count) => sum + count, 0)).toBe(7 + 70_000);
    expect(await fs.readdir(path.dirname(target))).toEqual(['Export.zip']);
  });

  it('replaces an existing file only once the archive is complete', async () => {
    const target = path.join(dir.path, 'Export.zip');
    await fs.writeFile(target, 'old');

    await writeZipArchive(target)([
      { path: 'a.json', compress: true, source: { data: Buffer.from('{}') } },
    ]);

    expect(readZipEntries(await fs.readFile(target)).map((entry) => entry.name)).toEqual([
      'a.json',
    ]);
  });

  it('leaves no file behind when cancelled while writing', async () => {
    const big = await mediaFile('big.ogg', 8 * 1024 * 1024);
    const target = path.join(dir.path, 'out', 'Export.zip');
    await fs.mkdir(path.dirname(target));
    const controller = new AbortController();

    await expect(
      writeZipArchive(target)(
        [{ path: 'media/big.ogg', compress: false, source: { file: big, size: 8 * 1024 * 1024 } }],
        { signal: controller.signal, onBytes: () => controller.abort() },
      ),
    ).rejects.toThrow();

    expect(await fs.readdir(path.dirname(target))).toEqual([]);
  });

  it('leaves no file behind when a file cannot be read', async () => {
    const target = path.join(dir.path, 'out', 'Export.zip');
    await fs.mkdir(path.dirname(target));

    await expect(
      writeZipArchive(target)([
        { path: 'a.json', compress: true, source: { data: Buffer.from('{}') } },
        {
          path: 'media/gone.png',
          compress: false,
          source: { file: path.join(dir.path, 'gone.png'), size: 3 },
        },
      ]),
    ).rejects.toThrow();

    expect(await fs.readdir(path.dirname(target))).toEqual([]);
  });

  it('writes nothing when already cancelled', async () => {
    const target = path.join(dir.path, 'Export.zip');
    const controller = new AbortController();
    controller.abort();

    await expect(
      writeZipArchive(target)(
        [{ path: 'a.json', compress: true, source: { data: Buffer.from('{}') } }],
        { signal: controller.signal },
      ),
    ).rejects.toThrow();
    expect(await fs.readdir(dir.path)).toEqual([]);
  });
});
