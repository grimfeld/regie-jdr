/**
 * Campaign Export (ADR-0005): a plain `.zip` of a Campaign's documents and Media, which Import
 * turns back into a new Campaign. No Electron dependency and no zip library: this module decides
 * what goes in the archive; a WriteArchive given by the main process (electron/zipArchive.ts)
 * writes it, streaming each Media file from disk.
 *
 * Archive layout (format version 1):
 *   regie-export.json            the manifest (ExportManifest), first entry
 *   <document>.json              each of CAMPAIGN_DOCUMENTS the Campaign's folder holds, compressed
 *   media/<sha256><extension>    the Media files the Media index lists, stored uncompressed
 * Never in an Export: `.tmp` and `.bak` files, thumbnails (rebuilt on demand), kept unreadable
 * Notes, any other file.
 *
 * The manifest records each document's `schemaVersion` as found on disk, so Import can refuse
 * an Export holding a document newer than the app and migrate older ones, and each Media file's
 * size, so Import can check what it unpacks. A change to this layout bumps
 * EXPORT_FORMAT_VERSION.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Media } from '../shared/domain.js';
import { isRecord } from './guards.js';
import { mediaFileName } from './mediaAddress.js';

export class ExportError extends Error {}

export const EXPORT_MANIFEST_FILE = 'regie-export.json';
export const EXPORT_FORMAT = 'regie-jdr-campaign-export';
export const EXPORT_FORMAT_VERSION = 1;
const MEDIA_FOLDER = 'media';
const CAMPAIGN_FILE = 'campaign.json';
/**
 * The documents of a Campaign's folder an Export holds, the ones Import accepts
 * (core/campaignImport.ts): an allowlist, so no other file there can spoil an Export.
 */
export const CAMPAIGN_DOCUMENTS: readonly string[] = [
  CAMPAIGN_FILE,
  'media.json',
  'scenes.json',
  'soundboard.json',
];

/** What an Export says about itself, as its first entry. */
export interface ExportManifest {
  format: typeof EXPORT_FORMAT;
  formatVersion: number;
  /** Version of the app that wrote the Export, for diagnosis only. */
  appVersion: string;
  /** ISO timestamp. */
  exportedAt: string;
  campaignName: string;
  /** Every document in the Export, with the `schemaVersion` it was stored with. */
  documents: { path: string; schemaVersion: number }[];
  /** Every Media file in the Export, with its size in bytes. */
  media: { path: string; size: number }[];
}

/** One file of an archive: bytes held in memory, or a file on disk read when it is written. */
export interface ArchiveEntry {
  /** Path inside the archive, with `/` separators. */
  path: string;
  /** Deflated when true; stored as is when false. */
  compress: boolean;
  source: { data: Uint8Array } | { file: string; size: number };
}

/**
 * Writes `entries`, in order, as one archive, streaming file entries from disk. Calls `onBytes`
 * with each count of entry bytes read. Rejects, leaving no partial archive, when writing fails or
 * `signal` aborts.
 */
export type WriteArchive = (
  entries: readonly ArchiveEntry[],
  options?: { signal?: AbortSignal; onBytes?: (bytes: number) => void },
) => Promise<void>;

export interface ExportProgress {
  doneBytes: number;
  totalBytes: number;
}

export interface ExportPlan {
  /** The manifest first, then documents, then Media files. */
  entries: ArchiveEntry[];
  /** Media files listed in the Media index but missing on disk, left out. */
  missingMedia: number;
  /** Bytes of every entry, before compression. */
  totalBytes: number;
}

/**
 * The entries of an Export. `documents` are the Campaign's documents with their text; `media`
 * the Media files, `size` undefined for one missing on disk. Throws ExportError for a document
 * that is not a stored document (unreadable JSON, no `schemaVersion`).
 */
export function planExport(input: {
  campaignName: string;
  appVersion: string;
  exportedAt: string;
  documents: readonly { path: string; text: string }[];
  media: readonly { path: string; file: string; size: number | undefined }[];
}): ExportPlan {
  const documents = input.documents.map(({ path: documentPath, text }) => ({
    path: documentPath,
    schemaVersion: schemaVersionOf(documentPath, text),
    data: Buffer.from(text, 'utf8'),
  }));
  const media = input.media.flatMap(({ path: mediaPath, file, size }) =>
    size === undefined ? [] : [{ path: mediaPath, file, size }],
  );
  const manifest: ExportManifest = {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    appVersion: input.appVersion,
    exportedAt: input.exportedAt,
    campaignName: input.campaignName,
    documents: documents.map(({ path: documentPath, schemaVersion }) => ({
      path: documentPath,
      schemaVersion,
    })),
    media: media.map(({ path: mediaPath, size }) => ({ path: mediaPath, size })),
  };
  const entries: ArchiveEntry[] = [
    {
      path: EXPORT_MANIFEST_FILE,
      compress: true,
      source: { data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8') },
    },
    ...documents.map(({ path: documentPath, data }) => ({
      path: documentPath,
      compress: true,
      source: { data },
    })),
    ...media.map(({ path: mediaPath, file, size }) => ({
      path: mediaPath,
      compress: false,
      source: { file, size },
    })),
  ];
  return {
    entries,
    missingMedia: input.media.length - media.length,
    totalBytes: entries.reduce((sum, entry) => sum + sizeOf(entry), 0),
  };
}

function sizeOf(entry: ArchiveEntry): number {
  return 'data' in entry.source ? entry.source.data.byteLength : entry.source.size;
}

function schemaVersionOf(documentPath: string, text: string): number {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = undefined;
  }
  const version = isRecord(raw) ? raw.schemaVersion : undefined;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new ExportError(
      `Le fichier « ${documentPath} » de la campagne est endommagé : ouvrez la campagne pour ` +
        'le réparer, puis exportez-la de nouveau.',
    );
  }
  return version;
}

/**
 * Default file name of an Export: "<Campaign name> – <local date>.zip", with the characters
 * Windows refuses in a file name replaced by `_`.
 */
export function exportFileName(campaignName: string, date: Date): string {
  const safeName =
    campaignName
      // eslint-disable-next-line no-control-regex -- control characters are refused by Windows
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
      .replace(/[. ]+$/, '')
      .trim() || 'Campagne';
  const day = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
  return `${safeName} – ${day}.zip`;
}

/**
 * Exports the Campaign in `campaignFolder` through `writeArchive`. `media` are the Media of its
 * index; the ones whose file is missing are left out and counted. The Campaign must be closed, so
 * that nothing writes to its folder meanwhile. Progress is in bytes read; `signal` cancels.
 */
export async function exportCampaign(input: {
  campaignFolder: string;
  campaignName: string;
  media: readonly Pick<Media, 'contentHash' | 'extension'>[];
  appVersion: string;
  writeArchive: WriteArchive;
  now?: () => Date;
  signal?: AbortSignal;
  onProgress?: (progress: ExportProgress) => void;
}): Promise<{ missingMedia: number }> {
  const { campaignFolder, signal, onProgress } = input;
  const now = input.now ?? (() => new Date());
  signal?.throwIfAborted();

  const documents = await readDocuments(campaignFolder);
  if (!documents.some((document) => document.path === CAMPAIGN_FILE)) {
    throw new ExportError('Cette campagne n’existe plus.');
  }
  const fileNames = [...new Set(input.media.map(mediaFileName))];
  const media = await Promise.all(
    fileNames.map(async (fileName) => {
      const file = path.join(campaignFolder, MEDIA_FOLDER, fileName);
      return { path: `${MEDIA_FOLDER}/${fileName}`, file, size: await fileSize(file) };
    }),
  );
  const plan = planExport({
    campaignName: input.campaignName,
    appVersion: input.appVersion,
    exportedAt: now().toISOString(),
    documents,
    media,
  });

  signal?.throwIfAborted();
  let doneBytes = 0;
  await input.writeArchive(plan.entries, {
    signal,
    onBytes(bytes) {
      doneBytes += bytes;
      onProgress?.({ doneBytes, totalBytes: plan.totalBytes });
    },
  });
  return { missingMedia: plan.missingMedia };
}

/** The CAMPAIGN_DOCUMENTS the Campaign's folder holds, with their text. */
async function readDocuments(folder: string): Promise<{ path: string; text: string }[]> {
  const documents = await Promise.all(
    CAMPAIGN_DOCUMENTS.map(async (name) => {
      try {
        return [{ path: name, text: await fsp.readFile(path.join(folder, name), 'utf8') }];
      } catch (error) {
        if (isRecord(error) && error.code === 'ENOENT') return [];
        throw error;
      }
    }),
  );
  return documents.flat();
}

/** Size of a file in bytes; undefined when it is missing or not a file. */
async function fileSize(file: string): Promise<number | undefined> {
  try {
    const stats = await fsp.stat(file);
    return stats.isFile() ? stats.size : undefined;
  } catch {
    return undefined;
  }
}
