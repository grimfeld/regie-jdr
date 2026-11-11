import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { exportCampaign } from '../../core/campaignExport';
import { importCampaign } from '../../core/campaignImport';
import { openZipArchive, writeZipArchive } from '../../electron/zipArchive';
import { rawZip, type RawZipEntry } from '../rawZip';
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

    const entries = await readZipEntries(await fs.readFile(target));
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

    expect((await readZipEntries(await fs.readFile(target))).map((entry) => entry.name)).toEqual([
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

  it('records its partial file before creating it, and forgets it once done or failed', async () => {
    const target = path.join(dir.path, 'out', 'Export.zip');
    await fs.mkdir(path.dirname(target));
    const events: string[] = [];
    const partials = {
      add: async (file: string) => {
        const created = await fs.lstat(file).then(
          () => true,
          () => false,
        );
        events.push(`add ${path.basename(file)} created=${String(created)}`);
      },
      remove: (file: string) => {
        events.push(`remove ${path.basename(file)}`);
        return Promise.reject(new Error('the list could not be saved'));
      },
    };

    // A list that cannot be saved after the rename does not fail a complete Export.
    await writeZipArchive(
      target,
      partials,
    )([{ path: 'a.json', compress: true, source: { data: Buffer.from('{}') } }]);
    await expect(
      writeZipArchive(
        target,
        partials,
      )([
        {
          path: 'media/gone.png',
          compress: false,
          source: { file: path.join(dir.path, 'gone.png'), size: 3 },
        },
      ]),
    ).rejects.toThrow();

    const partial = String.raw`Export\.zip\.[0-9a-f-]{36}\.partial`;
    expect(events).toEqual([
      expect.stringMatching(new RegExp(`^add ${partial} created=false$`)),
      expect.stringMatching(new RegExp(`^remove ${partial}$`)),
      expect.stringMatching(new RegExp(`^add ${partial} created=false$`)),
      expect.stringMatching(new RegExp(`^remove ${partial}$`)),
    ]);
    expect(await fs.readdir(path.dirname(target))).toEqual(['Export.zip']);
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

describe('openZipArchive', () => {
  const dir = useTempDir();
  const PIXELS = Buffer.from('pixels of a map');
  const HASH = createHash('sha256').update(PIXELS).digest('hex');
  const MEDIA = `media/${HASH}.png`;
  const CAMPAIGN = JSON.stringify({
    schemaVersion: 1,
    name: 'Les Ombres',
    theme: 'retro',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  const manifest = (media: { path: string; size: number }[] = [{ path: MEDIA, size: 15 }]) =>
    JSON.stringify({
      format: 'regie-jdr-campaign-export',
      formatVersion: 1,
      appVersion: '0.1.0',
      exportedAt: '2026-11-12T20:00:00.000Z',
      campaignName: 'Les Ombres',
      documents: [{ path: 'campaign.json', schemaVersion: 1 }],
      media,
    });

  const folders = () => ({
    campaignsFolder: path.join(dir.path, 'data', 'campaigns'),
    importsFolder: path.join(dir.path, 'data', 'imports'),
  });

  /** Imports the zip made of `entries`; returns what is left in the data folder. */
  async function importZip(entries: readonly RawZipEntry[]) {
    const file = path.join(dir.path, 'Export.zip');
    await fs.writeFile(file, rawZip(entries));
    const outcome = importCampaign({
      openArchive: openZipArchive(file),
      ...folders(),
      existingNames: [],
    });
    return outcome;
  }

  async function expectRefused(entries: readonly RawZipEntry[], message: RegExp) {
    await expect(importZip(entries)).rejects.toThrow(message);
    const left = await fs.readdir(path.join(dir.path, 'data'), { recursive: true });
    expect(left.sort()).toEqual(['imports']);
    // Nothing written next to the zip either (a zip-slip would land here or above).
    expect((await fs.readdir(dir.path)).sort()).toEqual(['Export.zip', 'data']);
  }

  const valid = (): RawZipEntry[] => [
    { name: 'regie-export.json', content: manifest(), deflate: true },
    { name: 'campaign.json', content: CAMPAIGN, deflate: true },
    { name: MEDIA, content: PIXELS },
  ];

  it('imports a hand-made zip of the Export format', async () => {
    const { id } = await importZip(valid());
    const folder = path.join(folders().campaignsFolder, id);
    expect(await fs.readFile(path.join(folder, 'media', `${HASH}.png`))).toEqual(PIXELS);
  });

  it('brings back what an Export wrote', async () => {
    const source = path.join(dir.path, 'source');
    await fs.mkdir(path.join(source, 'media'), { recursive: true });
    await fs.writeFile(path.join(source, 'campaign.json'), CAMPAIGN);
    await fs.writeFile(path.join(source, 'scenes.json'), '{"schemaVersion":3,"scenes":[]}');
    await fs.writeFile(path.join(source, 'media', `${HASH}.png`), PIXELS);
    const zip = path.join(dir.path, 'Les Ombres.zip');
    await exportCampaign({
      campaignFolder: source,
      campaignName: 'Les Ombres',
      media: [{ contentHash: HASH, extension: '.png' }],
      appVersion: '0.1.0',
      writeArchive: writeZipArchive(zip),
    });

    const { id, name } = await importCampaign({
      openArchive: openZipArchive(zip),
      ...folders(),
      existingNames: ['Les Ombres'],
    });

    expect(name).toBe('Les Ombres (importée)');
    const folder = path.join(folders().campaignsFolder, id);
    expect((await fs.readdir(folder)).sort()).toEqual(['campaign.json', 'media', 'scenes.json']);
    expect(await fs.readFile(path.join(folder, 'media', `${HASH}.png`))).toEqual(PIXELS);
    // Written at version 3, before Transitions: Import brings it to the current version.
    expect(JSON.parse(await fs.readFile(path.join(folder, 'scenes.json'), 'utf8'))).toEqual({
      schemaVersion: 5,
      scenes: [],
      chapters: [],
    });
  });

  /** A closed Campaign in `source` holding one Media of `size` bytes, as Export reads it. */
  async function bigCampaign(size: number) {
    const source = path.join(dir.path, 'source');
    const content = Buffer.alloc(size, 9);
    const hash = createHash('sha256').update(content).digest('hex');
    await fs.mkdir(path.join(source, 'media'), { recursive: true });
    await fs.writeFile(path.join(source, 'campaign.json'), CAMPAIGN);
    await fs.writeFile(path.join(source, 'media', `${hash}.ogg`), content);
    return { source, media: [{ contentHash: hash, extension: '.ogg' }] };
  }

  it('leaves no file at the chosen place when an Export is cancelled mid-stream', async () => {
    const { source, media } = await bigCampaign(16 * 1024 * 1024);
    const out = path.join(dir.path, 'out');
    await fs.mkdir(out);
    const controller = new AbortController();
    let lastDone = 0;

    await expect(
      exportCampaign({
        campaignFolder: source,
        campaignName: 'Les Ombres',
        media,
        appVersion: '0.1.0',
        writeArchive: writeZipArchive(path.join(out, 'Les Ombres.zip')),
        signal: controller.signal,
        onProgress: ({ doneBytes, totalBytes }) => {
          lastDone = doneBytes;
          // Past the documents, partway through the Media file.
          if (doneBytes > 1024 * 1024 && doneBytes < totalBytes) controller.abort();
        },
      }),
    ).rejects.toThrow();

    expect(lastDone).toBeLessThan(16 * 1024 * 1024);
    expect(await fs.readdir(out)).toEqual([]);
  });

  it('leaves no folder and no Campaign when an Import is cancelled mid-stream', async () => {
    const { source, media } = await bigCampaign(16 * 1024 * 1024);
    const zip = path.join(dir.path, 'Les Ombres.zip');
    await exportCampaign({
      campaignFolder: source,
      campaignName: 'Les Ombres',
      media,
      appVersion: '0.1.0',
      writeArchive: writeZipArchive(zip),
    });
    const controller = new AbortController();

    await expect(
      importCampaign({
        openArchive: openZipArchive(zip),
        ...folders(),
        existingNames: [],
        signal: controller.signal,
        onProgress: ({ doneBytes, totalBytes }) => {
          if (doneBytes > 0 && doneBytes < totalBytes) controller.abort();
        },
      }),
    ).rejects.toThrow();

    const left = await fs.readdir(path.join(dir.path, 'data'), { recursive: true });
    expect(left.sort()).toEqual(['imports']);
  });

  const UNREADABLE = /n’a pas pu être lu/;
  const REFUSED = /fichier non autorisé/;

  it.each([
    '../evil.json',
    '../../evil.json',
    '/evil.json',
    'C:/evil.json',
    'media\\..\\..\\evil.png',
    'C:\\evil.json',
  ])('refuses a zip with an entry named %j', async (hostile) => {
    await expectRefused([...valid(), { name: hostile, content: 'evil' }], UNREADABLE);
  });

  it('refuses a zip with an entry outside the Export layout', async () => {
    await expectRefused([...valid(), { name: 'thumbnails/x.png', content: 'x' }], REFUSED);
  });

  it('refuses a link, even under a listed path', async () => {
    const link = { name: MEDIA, content: '/etc/passwd', unixMode: 0o120777 };
    await expectRefused([valid()[0], valid()[1], link], REFUSED);
  });

  it('refuses an encrypted entry', async () => {
    // yauzl may already find it unreadable; either way it is refused.
    await expectRefused(
      [valid()[0], valid()[1], { ...valid()[2], encrypted: true }],
      /fichier non autorisé|n’a pas pu être lu/,
    );
  });

  it('refuses the same entry twice', async () => {
    await expectRefused([...valid(), valid()[2]], /endommagée/);
  });

  it('refuses a Media entry that unpacks to more than it declares', async () => {
    const lying = {
      name: MEDIA,
      content: Buffer.alloc(1024 * 1024),
      deflate: true,
      declaredSize: 15,
    };
    await expectRefused([valid()[0], valid()[1], lying], /endommagée|n’a pas pu être lu/);
  });

  it('refuses a Media entry deflated in the zip, even with honest sizes', async () => {
    const [manifestEntry, campaign, media] = valid();
    await expectRefused([manifestEntry, campaign, { ...media, deflate: true }], /endommagée/);
  });

  it('refuses a zip bomb before unpacking it', async () => {
    const size = 64 * 1024 * 1024;
    await expectRefused(
      [
        { name: 'regie-export.json', content: manifest([{ path: MEDIA, size }]) },
        { name: 'campaign.json', content: CAMPAIGN },
        { name: MEDIA, content: Buffer.alloc(size), deflate: true },
      ],
      /anormalement volumineuse/,
    );
  });

  it('refuses a file that is not a zip', async () => {
    const file = path.join(dir.path, 'Export.zip');
    await fs.writeFile(file, 'not a zip at all');
    await expect(
      importCampaign({ openArchive: openZipArchive(file), ...folders(), existingNames: [] }),
    ).rejects.toThrow(UNREADABLE);
  });
});
