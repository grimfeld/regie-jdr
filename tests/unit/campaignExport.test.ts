import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EXPORT_FORMAT,
  EXPORT_FORMAT_VERSION,
  EXPORT_MANIFEST_FILE,
  ExportError,
  exportCampaign,
  exportFileName,
  planExport,
  type ArchiveEntry,
  type ExportManifest,
  type WriteArchive,
} from '../../core/campaignExport';
import { useTempDir } from './tempDir';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function manifestOf(entries: readonly ArchiveEntry[]): ExportManifest {
  const [first] = entries;
  if (first.path !== EXPORT_MANIFEST_FILE || !('data' in first.source)) {
    throw new Error('The manifest is not the first entry');
  }
  return JSON.parse(Buffer.from(first.source.data).toString('utf8')) as ExportManifest;
}

/** A WriteArchive that keeps the entries it was given, reporting every byte as written. */
function recordingArchive() {
  const written: ArchiveEntry[][] = [];
  const writeArchive: WriteArchive = (entries, { onBytes } = {}) => {
    written.push([...entries]);
    for (const entry of entries) {
      onBytes?.('data' in entry.source ? entry.source.data.byteLength : entry.source.size);
    }
    return Promise.resolve();
  };
  return { written, writeArchive };
}

describe('planExport', () => {
  const base = {
    campaignName: 'Les Ombres',
    appVersion: '0.1.0',
    exportedAt: '2026-11-12T20:00:00.000Z',
  };

  it('puts a versioned manifest first, recording each document’s schema version', () => {
    const plan = planExport({
      ...base,
      documents: [
        { path: 'campaign.json', text: '{"schemaVersion":1,"name":"Les Ombres"}' },
        { path: 'scenes.json', text: '{"schemaVersion":3,"scenes":[]}' },
      ],
      media: [{ path: `media/${HASH_A}.png`, file: 'm', size: 120 }],
    });

    expect(plan.entries.map((entry) => entry.path)).toEqual([
      EXPORT_MANIFEST_FILE,
      'campaign.json',
      'scenes.json',
      `media/${HASH_A}.png`,
    ]);
    expect(manifestOf(plan.entries)).toEqual({
      format: EXPORT_FORMAT,
      formatVersion: EXPORT_FORMAT_VERSION,
      appVersion: '0.1.0',
      exportedAt: '2026-11-12T20:00:00.000Z',
      campaignName: 'Les Ombres',
      documents: [
        { path: 'campaign.json', schemaVersion: 1 },
        { path: 'scenes.json', schemaVersion: 3 },
      ],
      media: [{ path: `media/${HASH_A}.png`, size: 120 }],
    });
  });

  it('compresses documents and the manifest, and stores Media without recompression', () => {
    const plan = planExport({
      ...base,
      documents: [{ path: 'campaign.json', text: '{"schemaVersion":1}' }],
      media: [{ path: `media/${HASH_A}.png`, file: 'm', size: 120 }],
    });

    expect(plan.entries.map((entry) => [entry.path, entry.compress])).toEqual([
      [EXPORT_MANIFEST_FILE, true],
      ['campaign.json', true],
      [`media/${HASH_A}.png`, false],
    ]);
  });

  it('leaves missing Media out, counting them', () => {
    const plan = planExport({
      ...base,
      documents: [{ path: 'campaign.json', text: '{"schemaVersion":1}' }],
      media: [
        { path: `media/${HASH_A}.png`, file: 'm', size: undefined },
        { path: `media/${HASH_B}.ogg`, file: 'm', size: 9 },
      ],
    });

    expect(plan.missingMedia).toBe(1);
    expect(plan.entries.map((entry) => entry.path)).not.toContain(`media/${HASH_A}.png`);
    expect(manifestOf(plan.entries).media).toEqual([{ path: `media/${HASH_B}.ogg`, size: 9 }]);
  });

  it('counts every byte it will write', () => {
    const plan = planExport({
      ...base,
      documents: [{ path: 'campaign.json', text: '{"schemaVersion":1}' }],
      media: [{ path: `media/${HASH_A}.png`, file: 'm', size: 1000 }],
    });

    const manifestBytes = plan.entries[0].source;
    expect('data' in manifestBytes && manifestBytes.data.byteLength).toBeGreaterThan(0);
    expect(plan.totalBytes).toBe(
      plan.entries.reduce(
        (sum, { source }) => sum + ('data' in source ? source.data.byteLength : source.size),
        0,
      ),
    );
  });

  it.each([
    ['unreadable JSON', '{"schemaVersion":'],
    ['no schema version', '{"name":"x"}'],
    ['a schema version that is not a whole number', '{"schemaVersion":"2"}'],
    ['not an object', '[1]'],
  ])('refuses a document with %s, naming it', (_case, text) => {
    expect(() =>
      planExport({ ...base, documents: [{ path: 'scenes.json', text }], media: [] }),
    ).toThrow(
      new ExportError(
        'Le fichier « scenes.json » de la campagne est endommagé : ouvrez la campagne pour le ' +
          'réparer, puis exportez-la de nouveau.',
      ),
    );
  });
});

describe('exportFileName', () => {
  it('is the Campaign name and the local date', () => {
    expect(exportFileName('Les Ombres de Tarsis', new Date(2026, 10, 5, 23, 30))).toBe(
      'Les Ombres de Tarsis – 2026-11-05.zip',
    );
  });

  it('replaces characters Windows refuses in a file name', () => {
    expect(exportFileName('Star Wars: <Ep. 4/5> "Rogue"?*|\\', new Date(2026, 0, 2))).toBe(
      'Star Wars_ _Ep. 4_5_ _Rogue_____ – 2026-01-02.zip',
    );
  });

  it('never ends the name part with a dot or a space', () => {
    expect(exportFileName('Fin...  ', new Date(2026, 0, 2))).toBe('Fin – 2026-01-02.zip');
  });

  it('falls back to « Campagne » when nothing is left of the name', () => {
    expect(exportFileName('...', new Date(2026, 0, 2))).toBe('Campagne – 2026-01-02.zip');
  });
});

describe('exportCampaign', () => {
  const dir = useTempDir();
  const media = [
    { contentHash: HASH_A, extension: '.png' as const },
    { contentHash: HASH_B, extension: '.ogg' as const },
  ];

  /** A Campaign folder as the app leaves it: documents, backups, a temp file, thumbnails. */
  async function campaignFolder({ withMedia }: { withMedia: string[] }) {
    const folder = path.join(dir.path, 'campaign');
    await fs.mkdir(path.join(folder, 'media'), { recursive: true });
    await fs.mkdir(path.join(folder, 'thumbnails'), { recursive: true });
    await fs.writeFile(path.join(folder, 'campaign.json'), '{"schemaVersion":1,"name":"X"}');
    await fs.writeFile(path.join(folder, 'campaign.json.bak'), '{"schemaVersion":1}');
    await fs.writeFile(path.join(folder, 'scenes.json'), '{"schemaVersion":3,"scenes":[]}');
    await fs.writeFile(path.join(folder, 'scenes.json.tmp'), '{"schemaVersion":3');
    await fs.writeFile(path.join(folder, 'media.json'), '{"schemaVersion":2,"media":[]}');
    await fs.writeFile(path.join(folder, 'thumbnails', `${HASH_A}.png`), 'thumb');
    await fs.writeFile(path.join(folder, 'media', `${HASH_A}.png.1234.tmp`), 'partial');
    for (const file of withMedia) await fs.writeFile(path.join(folder, 'media', file), 'pixels');
    return folder;
  }

  const options = (folder: string, writeArchive: WriteArchive) => ({
    campaignFolder: folder,
    campaignName: 'Les Ombres',
    media,
    appVersion: '0.1.0',
    writeArchive,
    now: () => new Date('2026-11-12T20:00:00.000Z'),
  });

  it('writes the documents and Media, never temp files, backups or thumbnails', async () => {
    const folder = await campaignFolder({ withMedia: [`${HASH_A}.png`, `${HASH_B}.ogg`] });
    const { written, writeArchive } = recordingArchive();

    const result = await exportCampaign(options(folder, writeArchive));

    expect(result).toEqual({ missingMedia: 0 });
    const [entries] = written;
    expect(entries.map((entry) => entry.path)).toEqual([
      EXPORT_MANIFEST_FILE,
      'campaign.json',
      'media.json',
      'scenes.json',
      `media/${HASH_A}.png`,
      `media/${HASH_B}.ogg`,
    ]);
    expect(entries[4].source).toEqual({
      file: path.join(folder, 'media', `${HASH_A}.png`),
      size: 6,
    });
    expect(manifestOf(entries).documents).toEqual([
      { path: 'campaign.json', schemaVersion: 1 },
      { path: 'media.json', schemaVersion: 2 },
      { path: 'scenes.json', schemaVersion: 3 },
    ]);
  });

  it('skips Media missing on disk and says how many', async () => {
    const folder = await campaignFolder({ withMedia: [`${HASH_B}.ogg`] });
    const { written, writeArchive } = recordingArchive();

    const result = await exportCampaign(options(folder, writeArchive));

    expect(result).toEqual({ missingMedia: 1 });
    expect(written[0].map((entry) => entry.path)).not.toContain(`media/${HASH_A}.png`);
  });

  it('writes one file for Media sharing a content', async () => {
    const folder = await campaignFolder({ withMedia: [`${HASH_A}.png`, `${HASH_B}.ogg`] });
    const { written, writeArchive } = recordingArchive();

    await exportCampaign({ ...options(folder, writeArchive), media: [...media, media[0]] });

    expect(written[0].filter((entry) => entry.path === `media/${HASH_A}.png`)).toHaveLength(1);
  });

  it('reports progress up to the total, in bytes', async () => {
    const folder = await campaignFolder({ withMedia: [`${HASH_A}.png`, `${HASH_B}.ogg`] });
    const { writeArchive } = recordingArchive();
    const progress: { doneBytes: number; totalBytes: number }[] = [];

    await exportCampaign({ ...options(folder, writeArchive), onProgress: (p) => progress.push(p) });

    const last = progress[progress.length - 1];
    expect(last.doneBytes).toBe(last.totalBytes);
    expect(progress.map((p) => p.doneBytes)).toEqual(
      [...progress.map((p) => p.doneBytes)].sort((a, b) => a - b),
    );
  });

  it('passes the abort signal to the archive and writes nothing once aborted', async () => {
    const folder = await campaignFolder({ withMedia: [] });
    const { written, writeArchive } = recordingArchive();
    const controller = new AbortController();
    controller.abort();

    await expect(
      exportCampaign({ ...options(folder, writeArchive), signal: controller.signal }),
    ).rejects.toThrow();
    expect(written).toEqual([]);
  });

  it('refuses a folder without its Campaign document', async () => {
    const folder = await campaignFolder({ withMedia: [] });
    await fs.rm(path.join(folder, 'campaign.json'));

    await expect(exportCampaign(options(folder, recordingArchive().writeArchive))).rejects.toThrow(
      new ExportError('Cette campagne n’existe plus.'),
    );
  });
});
