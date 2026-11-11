import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EXPORT_FORMAT,
  EXPORT_FORMAT_VERSION,
  type ExportManifest,
} from '../../core/campaignExport';
import {
  admitDocument,
  createEntryChecker,
  importCampaign,
  importedCampaignName,
  ImportError,
  MAX_ARCHIVE_ENTRIES,
  parseExportManifest,
  type ArchiveFile,
  type ReadArchive,
} from '../../core/campaignImport';
import { MAX_CAMPAIGN_NAME_LENGTH } from '../../core/campaigns';
import { useTempDir } from './tempDir';

const PIXELS = Buffer.from('not really a png, but its hash names it');
const HASH = createHash('sha256').update(PIXELS).digest('hex');
const MEDIA_PATH = `media/${HASH}.png`;

const NOT_AN_EXPORT = /n’est pas une campagne exportée/;
const DAMAGED = /endommagée ou a été modifiée/;
const TOO_NEW = /version plus récente/;
const TOO_BIG = /anormalement volumineuse/;
const REFUSED = /fichier non autorisé/;

const campaignText = (name = 'Les Ombres') =>
  JSON.stringify({
    schemaVersion: 1,
    name,
    theme: 'fantasy',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  });

const mediaIndexText = (schemaVersion = 3) =>
  JSON.stringify({
    schemaVersion,
    media: [
      {
        id: 'image-1',
        contentHash: HASH,
        originalName: 'carte.png',
        name: 'carte',
        extension: '.png',
        kind: 'image',
        category: 'scenery',
      },
      {
        id: 'sound-1',
        contentHash: 'b'.repeat(64),
        originalName: 'pluie.ogg',
        name: 'pluie',
        extension: '.ogg',
        kind: 'audio',
        role: 'ambience',
        ...(schemaVersion >= 2 && { durationSeconds: 12 }),
      },
    ],
  });

function manifest(overrides: Partial<ExportManifest> = {}): ExportManifest {
  return {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    appVersion: '0.1.0',
    exportedAt: '2026-11-12T20:00:00.000Z',
    campaignName: 'Les Ombres',
    documents: [
      { path: 'campaign.json', schemaVersion: 1 },
      { path: 'media.json', schemaVersion: 3 },
      { path: 'scenes.json', schemaVersion: 3 },
    ],
    media: [{ path: MEDIA_PATH, size: PIXELS.byteLength }],
    ...overrides,
  };
}

const manifestText = (value: unknown) => JSON.stringify(value);

/** One entry of a fake archive. */
interface FakeEntry {
  path: string;
  content: Buffer | string;
  kind?: ArchiveFile['kind'];
  /** What the zip claims; the real size by default. */
  declaredSize?: number;
}

/** The entries of a well-formed Export, manifest first. */
function exportEntries(): FakeEntry[] {
  return [
    { path: 'regie-export.json', content: manifestText(manifest()) },
    { path: 'campaign.json', content: campaignText() },
    { path: 'media.json', content: mediaIndexText() },
    { path: 'scenes.json', content: '{"schemaVersion":3,"scenes":[]}' },
    { path: 'media/', content: '', kind: 'folder' },
    { path: MEDIA_PATH, content: PIXELS },
  ];
}

/** A ReadArchive over entries held in memory; `archiveBytes` defaults to their total size. */
function fakeArchive(
  entries: readonly FakeEntry[],
  options: { archiveBytes?: number; entryCount?: number } = {},
) {
  const state = { closed: false };
  const files: ArchiveFile[] = entries.map((entry) => {
    const content = Buffer.from(entry.content);
    return {
      path: entry.path,
      kind: entry.kind ?? 'file',
      declaredSize: entry.declaredSize ?? content.byteLength,
      open() {
        // Content in small chunks, as a stream gives it.
        async function* chunks() {
          for (let at = 0; at < content.byteLength; at += 4096) {
            await Promise.resolve();
            yield content.subarray(at, at + 4096);
          }
        }
        return Promise.resolve(chunks());
      },
    };
  });
  const archive: ReadArchive = {
    archiveBytes:
      options.archiveBytes ??
      files.reduce((sum, file) => sum + Buffer.from(file.path).byteLength + file.declaredSize, 0),
    entryCount: options.entryCount ?? files.length,
    async *entries() {
      for (const file of files) {
        await Promise.resolve();
        yield file;
      }
    },
    close() {
      state.closed = true;
    },
  };
  return { open: () => Promise.resolve(archive), state };
}

/** Paths that must never be accepted as an entry, whatever the manifest says. */
const HOSTILE_PATHS = [
  '../campaign.json',
  '../../evil.json',
  '/etc/evil.json',
  'C:/Windows/evil.json',
  'C:\\Windows\\evil.json',
  '..\\..\\evil.json',
  'media\\..\\..\\evil.png',
  `media/../../${HASH}.png`,
  `media/../${HASH}.png`,
  `media/sub/${HASH}.png`,
  `media//${HASH}.png`,
  `./media/${HASH}.png`,
  `MEDIA/${HASH}.png`,
  `media/${HASH.toUpperCase()}.png`,
  `media/${HASH}.png:hidden`,
  `media/${HASH}.png.`,
  `media/${HASH}.exe`,
  `media/${HASH}.svg`,
  'media/carte.png',
  'thumbnails/x.png',
  'campaign.json.bak',
  'scenes.json.tmp',
  'Campaign.json',
  'campaign.json ',
  '\\\\server\\share\\evil.json',
  'campaign.json\u0000.png',
];

describe('parseExportManifest', () => {
  it('accepts the manifest of an Export', () => {
    expect(parseExportManifest(manifestText(manifest()))).toEqual(manifest());
  });

  it.each([
    ['text that is not JSON', 'PK\u0003\u0004'],
    ['another format', manifestText({ ...manifest(), format: 'something-else' })],
    ['a JSON array', '[]'],
  ])('refuses %s as not an Export', (_case, text) => {
    expect(() => parseExportManifest(text)).toThrow(NOT_AN_EXPORT);
  });

  it('refuses a manifest from a newer format version', () => {
    const newer = manifest({ formatVersion: EXPORT_FORMAT_VERSION + 1 });
    expect(() => parseExportManifest(manifestText(newer))).toThrow(TOO_NEW);
  });

  it('refuses a document this app does not know, as written by a newer version', () => {
    const documents = [...manifest().documents, { path: 'chapters.json', schemaVersion: 1 }];
    expect(() => parseExportManifest(manifestText(manifest({ documents })))).toThrow(TOO_NEW);
  });

  it.each(HOSTILE_PATHS)('refuses to list the path %j', (hostile) => {
    const asDocument = manifest({
      documents: [...manifest().documents, { path: hostile, schemaVersion: 1 }],
    });
    const asMedia = manifest({ media: [{ path: hostile, size: 3 }] });
    expect(() => parseExportManifest(manifestText(asDocument))).toThrow(ImportError);
    expect(() => parseExportManifest(manifestText(asMedia))).toThrow(ImportError);
  });

  it('refuses a path listed twice, in any letter case', () => {
    const twice = manifest({
      media: [
        { path: MEDIA_PATH, size: 3 },
        { path: MEDIA_PATH, size: 3 },
      ],
    });
    expect(() => parseExportManifest(manifestText(twice))).toThrow(DAMAGED);
  });

  it.each([
    ['without its Campaign document', { documents: [{ path: 'scenes.json', schemaVersion: 3 }] }],
    ['with a negative Media size', { media: [{ path: MEDIA_PATH, size: -1 }] }],
    ['with a fractional Media size', { media: [{ path: MEDIA_PATH, size: 1.5 }] }],
    ['with an unsafe Media size', { media: [{ path: MEDIA_PATH, size: 2 ** 60 }] }],
    ['with a schema version of zero', { documents: [{ path: 'campaign.json', schemaVersion: 0 }] }],
    ['with documents that are not a list', { documents: {} }],
  ])('refuses a manifest %s', (_case, overrides) => {
    const broken = { ...manifest(), ...overrides };
    expect(() => parseExportManifest(manifestText(broken))).toThrow(DAMAGED);
  });

  it('refuses a manifest listing more Media than a zip may hold', () => {
    const media = Array.from({ length: MAX_ARCHIVE_ENTRIES + 1 }, () => ({
      path: MEDIA_PATH,
      size: 1,
    }));
    expect(() => parseExportManifest(manifestText(manifest({ media })))).toThrow(DAMAGED);
  });
});

describe('createEntryChecker', () => {
  const file = (entryPath: string, declaredSize = 3) => ({
    path: entryPath,
    kind: 'file' as const,
    declaredSize,
  });

  it('accepts the documents and Media the manifest lists, and the media folder', () => {
    const checker = createEntryChecker(manifest());
    expect(checker.check(file('campaign.json'))).toEqual({
      role: 'document',
      path: 'campaign.json',
      schemaVersion: 1,
    });
    expect(checker.check({ path: 'media/', kind: 'folder', declaredSize: 0 })).toEqual({
      role: 'folder',
    });
    expect(checker.check(file(MEDIA_PATH, PIXELS.byteLength))).toEqual({
      role: 'media',
      path: MEDIA_PATH,
      fileName: `${HASH}.png`,
      contentHash: HASH,
      size: PIXELS.byteLength,
    });
  });

  it.each(HOSTILE_PATHS)('refuses the entry %j', (hostile) => {
    expect(() => createEntryChecker(manifest()).check(file(hostile))).toThrow(REFUSED);
  });

  it('refuses another manifest after the first', () => {
    expect(() => createEntryChecker(manifest()).check(file('regie-export.json'))).toThrow(REFUSED);
  });

  it.each(['link', 'other', 'folder'] as const)(
    'refuses a %s entry even under a listed path',
    (kind) => {
      const checker = createEntryChecker(manifest());
      expect(() => checker.check({ path: MEDIA_PATH, kind, declaredSize: 3 })).toThrow(REFUSED);
      expect(() => checker.check({ path: 'campaign.json', kind, declaredSize: 3 })).toThrow(
        REFUSED,
      );
    },
  );

  it('refuses an entry seen twice', () => {
    const checker = createEntryChecker(manifest());
    checker.check(file('campaign.json'));
    expect(() => checker.check(file('campaign.json'))).toThrow(DAMAGED);
  });

  it('refuses a Media entry whose declared size is not the manifest’s', () => {
    expect(() => createEntryChecker(manifest()).check(file(MEDIA_PATH, 1))).toThrow(DAMAGED);
  });

  it('refuses a document declared larger than a document may be', () => {
    expect(() => createEntryChecker(manifest()).check(file('scenes.json', 2 ** 31))).toThrow(
      TOO_BIG,
    );
  });

  it('refuses, at the end, a listed document the zip lacks, but not a missing Media', () => {
    const checker = createEntryChecker(manifest());
    checker.check(file('campaign.json'));
    checker.check(file('media.json'));
    expect(() => checker.finish()).toThrow(DAMAGED);
    checker.check(file('scenes.json'));
    expect(() => checker.finish()).not.toThrow();
  });
});

describe('admitDocument', () => {
  const media = { path: 'media.json', schemaVersion: 3 };

  it('keeps a document at the current version', () => {
    expect(JSON.parse(admitDocument(media, mediaIndexText()))).toEqual(
      JSON.parse(mediaIndexText()),
    );
  });

  it('migrates a document of an older version and stores it at the current one', () => {
    const stored: unknown = JSON.parse(
      admitDocument({ path: 'media.json', schemaVersion: 1 }, mediaIndexText(1)),
    );
    expect(stored).toMatchObject({
      schemaVersion: 3,
      media: [{ id: 'image-1' }, { id: 'sound-1', durationSeconds: null }],
    });
  });

  it('refuses a document of a newer version', () => {
    const newer = JSON.stringify({ ...JSON.parse(mediaIndexText()), schemaVersion: 99 });
    expect(() => admitDocument({ path: 'media.json', schemaVersion: 99 }, newer)).toThrow(TOO_NEW);
  });

  it.each([
    ['unreadable JSON', '{"schemaVersion":3,'],
    ['no schema version', '{"media":[]}'],
    ['a field of the wrong type', '{"schemaVersion":3,"media":{}}'],
    [
      'a Media with a path for a hash',
      JSON.stringify({
        schemaVersion: 3,
        media: [
          {
            id: 'x',
            contentHash: '../x',
            originalName: 'x',
            name: 'x',
            extension: '.png',
            kind: 'image',
            category: 'scenery',
          },
        ],
      }),
    ],
    ['a disallowed Media type', mediaIndexText().replace('".png"', '".exe"')],
  ])('refuses a document with %s', (_case, text) => {
    expect(() => admitDocument(media, text)).toThrow(DAMAGED);
  });

  it('refuses a document whose version is not the one the manifest lists', () => {
    expect(() => admitDocument({ path: 'media.json', schemaVersion: 2 }, mediaIndexText())).toThrow(
      DAMAGED,
    );
  });
});

describe('importedCampaignName', () => {
  it('keeps the name when no Campaign has it', () => {
    expect(importedCampaignName('Les Ombres', ['Tarsis'])).toBe('Les Ombres');
  });

  it('adds « (importée) » when a Campaign has that name, in any letter case', () => {
    expect(importedCampaignName('Les Ombres', ['les ombres '])).toBe('Les Ombres (importée)');
  });

  it('stays within the longest Campaign name', () => {
    const long = 'x'.repeat(MAX_CAMPAIGN_NAME_LENGTH);
    const name = importedCampaignName(long, [long]);
    expect(name).toHaveLength(MAX_CAMPAIGN_NAME_LENGTH);
    expect(name.endsWith(' (importée)')).toBe(true);
  });
});

describe('importCampaign', () => {
  const dir = useTempDir();
  const folders = () => ({
    campaignsFolder: path.join(dir.path, 'campaigns'),
    importsFolder: path.join(dir.path, 'imports'),
  });

  async function filesUnder(folder: string): Promise<string[]> {
    try {
      return (await fs.readdir(folder, { recursive: true })).sort();
    } catch {
      return [];
    }
  }

  /** Imports the fake archive; on refusal, checks nothing was left behind. */
  async function attempt(
    entries: readonly FakeEntry[],
    options: Parameters<typeof fakeArchive>[1] & { existingNames?: string[] } = {},
  ) {
    const archive = fakeArchive(entries, options);
    const { campaignsFolder, importsFolder } = folders();
    try {
      return await importCampaign({
        openArchive: archive.open,
        campaignsFolder,
        importsFolder,
        existingNames: options.existingNames ?? [],
      });
    } finally {
      expect(archive.state.closed).toBe(true);
      expect(await filesUnder(importsFolder)).toEqual([]);
    }
  }

  async function expectRefused(entries: readonly FakeEntry[], message: RegExp, options = {}) {
    await expect(attempt(entries, options)).rejects.toThrow(message);
    expect(await filesUnder(folders().campaignsFolder)).toEqual([]);
  }

  const replace = (entryPath: string, entry: Partial<FakeEntry>) =>
    exportEntries().map((current) =>
      current.path === entryPath ? { ...current, ...entry } : current,
    );

  it('creates a new Campaign with the documents and Media of the Export', async () => {
    const { id, name } = await attempt(exportEntries());

    expect(name).toBe('Les Ombres');
    const folder = path.join(folders().campaignsFolder, id);
    expect(await filesUnder(folders().campaignsFolder)).toEqual(
      [
        id,
        path.join(id, 'campaign.json'),
        path.join(id, 'media'),
        path.join(id, 'media.json'),
        path.join(id, 'media', `${HASH}.png`),
        path.join(id, 'scenes.json'),
      ].sort(),
    );
    expect(await fs.readFile(path.join(folder, 'media', `${HASH}.png`))).toEqual(PIXELS);
    expect(JSON.parse(await fs.readFile(path.join(folder, 'campaign.json'), 'utf8'))).toEqual(
      JSON.parse(campaignText()),
    );
  });

  it('gives every Import a new id, adding « (importée) » to a name already taken', async () => {
    const first = await attempt(exportEntries());
    const second = await attempt(exportEntries(), { existingNames: [first.name] });

    expect(second.id).not.toBe(first.id);
    expect(second.name).toBe('Les Ombres (importée)');
    const stored: unknown = JSON.parse(
      await fs.readFile(path.join(folders().campaignsFolder, second.id, 'campaign.json'), 'utf8'),
    );
    expect(stored).toMatchObject({ name: 'Les Ombres (importée)' });
  });

  it('migrates documents of an older version', async () => {
    const entries = exportEntries().map((entry) =>
      entry.path === 'media.json' ? { ...entry, content: mediaIndexText(1) } : entry,
    );
    entries[0].content = manifestText(
      manifest({
        documents: [
          { path: 'campaign.json', schemaVersion: 1 },
          { path: 'media.json', schemaVersion: 1 },
          { path: 'scenes.json', schemaVersion: 3 },
        ],
      }),
    );

    const { id } = await attempt(entries);

    const stored: unknown = JSON.parse(
      await fs.readFile(path.join(folders().campaignsFolder, id, 'media.json'), 'utf8'),
    );
    expect(stored).toMatchObject({ schemaVersion: 3, media: [{}, { durationSeconds: null }] });
  });

  it('imports a Campaign whose Media the zip lacks, so they show as missing', async () => {
    const { id } = await attempt(exportEntries().filter((entry) => entry.path !== MEDIA_PATH));
    expect(await fs.readdir(path.join(folders().campaignsFolder, id, 'media'))).toEqual([]);
  });

  it('reports progress in Media bytes, up to the total', async () => {
    const archive = fakeArchive(exportEntries());
    const progress: number[] = [];
    await importCampaign({
      openArchive: archive.open,
      ...folders(),
      existingNames: [],
      onProgress: ({ doneBytes, totalBytes }) => {
        expect(totalBytes).toBe(PIXELS.byteLength);
        progress.push(doneBytes);
      },
    });
    expect(progress.at(0)).toBe(0);
    expect(progress.at(-1)).toBe(PIXELS.byteLength);
  });

  it('leaves nothing behind when cancelled', async () => {
    const controller = new AbortController();
    const archive = fakeArchive(exportEntries());
    await expect(
      importCampaign({
        openArchive: archive.open,
        ...folders(),
        existingNames: [],
        signal: controller.signal,
        onProgress: ({ doneBytes }) => {
          if (doneBytes > 0) controller.abort();
        },
      }),
    ).rejects.toThrow();
    expect(await filesUnder(folders().campaignsFolder)).toEqual([]);
    expect(await filesUnder(folders().importsFolder)).toEqual([]);
  });

  it('never overwrites a Campaign folder already there', async () => {
    const { campaignsFolder, importsFolder } = folders();
    await fs.mkdir(path.join(campaignsFolder, 'taken'), { recursive: true });
    await fs.writeFile(path.join(campaignsFolder, 'taken', 'campaign.json'), 'mine');

    await expect(
      importCampaign({
        openArchive: fakeArchive(exportEntries()).open,
        campaignsFolder,
        importsFolder,
        existingNames: [],
        newId: () => 'taken',
      }),
    ).rejects.toThrow(ImportError);
    expect(await fs.readFile(path.join(campaignsFolder, 'taken', 'campaign.json'), 'utf8')).toBe(
      'mine',
    );
    expect(await filesUnder(importsFolder)).toEqual([]);
  });

  describe('refuses, leaving nothing behind,', () => {
    it('a zip whose first entry is not the manifest', async () => {
      await expectRefused(exportEntries().slice(1), NOT_AN_EXPORT);
    });

    it('a zip with no entry at all', async () => {
      await expectRefused([], NOT_AN_EXPORT);
    });

    it('a manifest from a newer format version', async () => {
      const newer = manifest({ formatVersion: EXPORT_FORMAT_VERSION + 1 });
      await expectRefused(replace('regie-export.json', { content: manifestText(newer) }), TOO_NEW);
    });

    it.each(HOSTILE_PATHS)('an entry named %j, after a Media was unpacked', async (hostile) => {
      await expectRefused([...exportEntries(), { path: hostile, content: 'evil' }], REFUSED);
    });

    it('a link entry', async () => {
      await expectRefused(replace(MEDIA_PATH, { kind: 'link', content: '/etc/passwd' }), REFUSED);
    });

    it('an encrypted or otherwise unreadable entry', async () => {
      await expectRefused(replace(MEDIA_PATH, { kind: 'other' }), REFUSED);
    });

    it('a Media entry the manifest does not list', async () => {
      const other = `media/${'c'.repeat(64)}.png`;
      await expectRefused([...exportEntries(), { path: other, content: 'x' }], REFUSED);
    });

    it('the same entry twice', async () => {
      const entries = exportEntries();
      await expectRefused([...entries, entries[1]], DAMAGED);
    });

    it('a Media file whose content does not match the hash in its name', async () => {
      const forged = Buffer.from(PIXELS).fill(0x41);
      await expectRefused(replace(MEDIA_PATH, { content: forged }), DAMAGED);
    });

    it('a Media file longer than its declared size', async () => {
      const longer = Buffer.concat([PIXELS, Buffer.alloc(10_000)]);
      await expectRefused(
        replace(MEDIA_PATH, { content: longer, declaredSize: PIXELS.byteLength }),
        DAMAGED,
      );
    });

    it('a Media file shorter than its declared size', async () => {
      await expectRefused(
        replace(MEDIA_PATH, { content: PIXELS.subarray(1), declaredSize: PIXELS.byteLength }),
        DAMAGED,
      );
    });

    it('a document that does not parse', async () => {
      await expectRefused(replace('scenes.json', { content: '{"schemaVersion":3,' }), DAMAGED);
    });

    it('a document that is not UTF-8', async () => {
      await expectRefused(
        replace('scenes.json', { content: Buffer.from([0x7b, 0xff, 0xfe, 0x7d]) }),
        DAMAGED,
      );
    });

    it('a document of a newer schema version', async () => {
      await expectRefused(
        replace('scenes.json', { content: '{"schemaVersion":99,"scenes":[]}' }),
        TOO_NEW,
      );
    });

    it('a zip declaring more entries than a zip may hold', async () => {
      await expectRefused(exportEntries(), TOO_BIG, { entryCount: MAX_ARCHIVE_ENTRIES + 1 });
    });

    it('a manifest listing far more Media bytes than the zip could hold', async () => {
      const bomb = manifest({ media: [{ path: MEDIA_PATH, size: 2 ** 40 }] });
      await expectRefused(replace('regie-export.json', { content: manifestText(bomb) }), TOO_BIG);
    });

    it('a document unpacking to far more than the zip’s size, whatever it declares', async () => {
      const huge = `{"schemaVersion":3,"scenes":[]${' '.repeat(17 * 1024 * 1024)}}`;
      await expectRefused(replace('scenes.json', { content: huge, declaredSize: 10 }), TOO_BIG, {
        archiveBytes: 1000,
      });
    });
  });
});
