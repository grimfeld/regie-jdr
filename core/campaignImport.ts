/**
 * Campaign Import (ADR-0005): turns an Export (core/campaignExport.ts) back into a new Campaign.
 * No Electron dependency and no zip library: a ReadArchive given by the main process
 * (electron/zipArchive.ts) lists the entries and streams their content; this module decides
 * what is accepted and writes it.
 *
 * The zip is untrusted input, from another computer or another person. It is checked entry by
 * entry and unpacked into a staging folder under the imports folder; only when everything passed
 * is that folder renamed into the campaigns folder, in one step, under a new Campaign id. Any
 * failure or cancel removes the staging folder: nothing is left behind and nothing existing is
 * ever overwritten.
 *
 * Rules, each a refusal of the whole zip:
 * - The manifest is the first entry, of this format, at a format version this app knows.
 * - Every other entry is a path the manifest lists, spelled exactly as it lists it. Manifest
 *   paths are themselves checked against a strict pattern (a known document at the top, or
 *   `media/<sha256><allowlisted extension>`), so no entry can name a path outside the staging
 *   folder: no `..`, absolute path, drive letter, backslash, colon or other folder. The only
 *   other entry accepted is the `media/` folder entry, which writes nothing.
 * - Links and other special entries are refused; so is an entry seen twice (in any letter case,
 *   as Windows folders ignore case).
 * - Sizes the zip declares are never trusted: content is counted as it streams, a Media file
 *   must have exactly the size the manifest gives and the content hash its name gives, documents
 *   and the manifest are capped, and the whole is capped relative to the zip's own size (a zip
 *   bomb is refused before it fills the disk).
 * - Every document parses as its type. A `schemaVersion` newer than this app reads is refused;
 *   older ones go through the type's migrations, and documents are written back at the current
 *   version.
 * Media the manifest lists but the zip lacks are allowed: the Campaign shows them missing.
 */
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { CampaignId } from '../shared/domain.js';
import {
  EXPORT_FORMAT,
  EXPORT_FORMAT_VERSION,
  EXPORT_MANIFEST_FILE,
  type ExportManifest,
  type ExportProgress,
} from './campaignExport.js';
import { MAX_CAMPAIGN_NAME_LENGTH } from './campaigns.js';
import { isRecord } from './guards.js';
import { mediaIndexDocument } from './media.js';
import { isMediaExtension } from './mediaAddress.js';
import { scenesDocument } from './scenes.js';
import { soundboardDocument } from './soundboard.js';
import { campaignDocument } from './storage/campaigns.js';
import {
  decodeDocument,
  encodeDocument,
  nodeFileSystem,
  type DocumentType,
} from './storage/documents.js';

export class ImportError extends Error {}

const NOT_AN_EXPORT =
  'Ce fichier n’est pas une campagne exportée par l’application : il n’a pas été importé.';
const UNREADABLE =
  'Ce fichier n’a pas pu être lu : il est endommagé ou ce n’est pas une archive zip. ' +
  'Rien n’a été importé.';
const DAMAGED = 'Cette exportation est endommagée ou a été modifiée : rien n’a été importé.';
const TOO_NEW =
  'Cette campagne a été exportée par une version plus récente de l’application : ' +
  'mettez l’application à jour pour l’importer.';
const TOO_BIG = 'Cette exportation est anormalement volumineuse : rien n’a été importé.';

function refusedEntry(entryPath: string): ImportError {
  // The name comes from the zip: shown short and without control characters.
  // eslint-disable-next-line no-control-regex -- control characters are what is removed
  const shown = entryPath.replace(/[\u0000-\u001f\u007f]/g, '?').slice(0, 80);
  return new ImportError(
    `Cette exportation contient un fichier non autorisé (« ${shown} ») : rien n’a été importé.`,
  );
}

/** The error for a zip the archive reader cannot read; `cause` keeps the reader's detail. */
export function unreadableArchive(cause: unknown): ImportError {
  return new ImportError(UNREADABLE, { cause });
}

/** Most entries a zip may have. */
export const MAX_ARCHIVE_ENTRIES = 100_000;
/** Largest manifest, in bytes. */
export const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
/** Largest document, in bytes. */
export const MAX_DOCUMENT_BYTES = 64 * 1024 * 1024;
/**
 * How many times its own size a zip may unpack to, plus a fixed allowance. Media are stored
 * uncompressed in an Export and documents compress about tenfold, so a real Export stays far
 * below; a zip bomb does not.
 */
export const MAX_EXPANSION = 50;
const EXPANSION_ALLOWANCE = 16 * 1024 * 1024;

/** Most bytes a zip of `archiveBytes` may unpack to. */
export function unpackLimit(archiveBytes: number): number {
  return archiveBytes * MAX_EXPANSION + EXPANSION_ALLOWANCE;
}

const MEDIA_FOLDER = 'media';
const CAMPAIGN_FILE = 'campaign.json';

/** The documents an Export may hold, by path. */
const DOCUMENT_TYPES = new Map<string, DocumentType<unknown>>([
  [CAMPAIGN_FILE, campaignDocument],
  ['media.json', mediaIndexDocument],
  ['scenes.json', scenesDocument],
  ['soundboard.json', soundboardDocument],
]);

/** A document name as an Export writes one; known or not, it names no other folder. */
const DOCUMENT_PATH = /^[a-z0-9][a-z0-9-]{0,63}\.json$/;
/** A Media file as an Export writes one: its content's SHA-256 and its extension. */
const MEDIA_PATH = /^media\/([0-9a-f]{64})(\.[a-z0-9]{1,8})$/;

/** One entry of a zip, as the archive reader describes it. */
export interface ArchiveFile {
  /** The entry's name in the zip, as stored (untrusted). */
  path: string;
  /** A link or any other special entry is `other`, `link` or `folder`, never `file`. */
  kind: 'file' | 'folder' | 'link' | 'other';
  /** Uncompressed size the zip declares: checked, never trusted. */
  declaredSize: number;
  /** Streams the entry's content, unpacked. */
  open(): Promise<AsyncIterable<Uint8Array>>;
}

/** A zip opened for reading. */
export interface ReadArchive {
  /** Size of the zip file, in bytes. */
  archiveBytes: number;
  /** Number of entries the zip declares. */
  entryCount: number;
  /** The entries, in the zip's order. Fails with an ImportError when the zip is damaged. */
  entries(): AsyncIterable<ArchiveFile>;
  close(): void;
}

/** Opens the zip to import; fails with an ImportError when it is not a readable zip. */
export type OpenArchive = () => Promise<ReadArchive>;

export type ImportProgress = ExportProgress;

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isVersion(value: unknown): value is number {
  return isCount(value) && value >= 1;
}

/** Lower-cased: Windows folders ignore letter case, so two such names are one file. */
const fileKey = (entryPath: string) => entryPath.toLowerCase();

/**
 * The manifest of an Export, checked: its format and version, and every path it lists (see the
 * rules at the top). Throws ImportError.
 */
export function parseExportManifest(text: string): ExportManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ImportError(NOT_AN_EXPORT);
  }
  if (!isRecord(raw) || raw.format !== EXPORT_FORMAT) throw new ImportError(NOT_AN_EXPORT);
  const { formatVersion, appVersion, exportedAt, campaignName, documents, media } = raw;
  if (!isVersion(formatVersion)) throw new ImportError(DAMAGED);
  if (formatVersion > EXPORT_FORMAT_VERSION) throw new ImportError(TOO_NEW);
  if (typeof appVersion !== 'string' || typeof exportedAt !== 'string') {
    throw new ImportError(DAMAGED);
  }
  if (typeof campaignName !== 'string' || !Array.isArray(documents) || !Array.isArray(media)) {
    throw new ImportError(DAMAGED);
  }
  if (documents.length > DOCUMENT_TYPES.size || media.length > MAX_ARCHIVE_ENTRIES) {
    throw new ImportError(DAMAGED);
  }
  const listed = new Set<string>();
  const list = (entryPath: string) => {
    if (listed.has(fileKey(entryPath))) throw new ImportError(DAMAGED);
    listed.add(fileKey(entryPath));
  };
  const parsedDocuments = documents.map((document: unknown) => {
    if (!isRecord(document) || typeof document.path !== 'string') {
      throw new ImportError(DAMAGED);
    }
    const { path: documentPath, schemaVersion } = document;
    if (!DOCUMENT_PATH.test(documentPath)) throw refusedEntry(documentPath);
    // A document this app does not know of was added by a newer version.
    if (!DOCUMENT_TYPES.has(documentPath)) throw new ImportError(TOO_NEW);
    if (!isVersion(schemaVersion)) throw new ImportError(DAMAGED);
    list(documentPath);
    return { path: documentPath, schemaVersion };
  });
  const parsedMedia = media.map((file: unknown) => {
    if (!isRecord(file) || typeof file.path !== 'string') throw new ImportError(DAMAGED);
    const { path: mediaPath, size } = file;
    const extension = MEDIA_PATH.exec(mediaPath)?.[2];
    if (extension === undefined || !isMediaExtension(extension)) throw refusedEntry(mediaPath);
    if (!isCount(size)) throw new ImportError(DAMAGED);
    list(mediaPath);
    return { path: mediaPath, size };
  });
  if (!listed.has(CAMPAIGN_FILE)) throw new ImportError(DAMAGED);
  return {
    format: EXPORT_FORMAT,
    formatVersion,
    appVersion,
    exportedAt,
    campaignName,
    documents: parsedDocuments,
    media: parsedMedia,
  };
}

/** What an entry of the zip is, once checked against the manifest. */
export type CheckedEntry =
  | { role: 'folder' }
  | { role: 'document'; path: string; schemaVersion: number }
  | { role: 'media'; path: string; fileName: string; contentHash: string; size: number };

export interface EntryChecker {
  /** Checks the next entry after the manifest; throws ImportError when it is refused. */
  check(entry: Pick<ArchiveFile, 'path' | 'kind' | 'declaredSize'>): CheckedEntry;
  /** Checks, once every entry was seen, that none the manifest requires is missing. */
  finish(): void;
}

/** Checks the entries that follow `manifest` in a zip, one by one (see the rules at the top). */
export function createEntryChecker(manifest: ExportManifest): EntryChecker {
  const documents = new Map(manifest.documents.map((document) => [document.path, document]));
  const media = new Map(manifest.media.map((file) => [file.path, file]));
  const seen = new Set<string>();

  return {
    check({ path: entryPath, kind, declaredSize }) {
      if (kind === 'folder' && entryPath === `${MEDIA_FOLDER}/`) return { role: 'folder' };
      const document = documents.get(entryPath);
      const file = media.get(entryPath);
      if (kind !== 'file' || (!document && !file)) throw refusedEntry(entryPath);
      if (seen.has(fileKey(entryPath))) throw new ImportError(DAMAGED);
      seen.add(fileKey(entryPath));
      if (document) {
        if (declaredSize > MAX_DOCUMENT_BYTES) throw new ImportError(TOO_BIG);
        return { role: 'document', ...document };
      }
      // `file` is set: the path matched the manifest's media pattern when it was parsed.
      const match = MEDIA_PATH.exec(entryPath);
      if (!file || !match) throw refusedEntry(entryPath);
      const [, contentHash, extension] = match;
      if (declaredSize !== file.size) throw new ImportError(DAMAGED);
      return {
        role: 'media',
        path: entryPath,
        fileName: `${contentHash}${extension}`,
        contentHash,
        size: file.size,
      };
    },
    finish() {
      if (manifest.documents.some((document) => !seen.has(fileKey(document.path)))) {
        throw new ImportError(DAMAGED);
      }
    },
  };
}

/**
 * A document of the zip, checked and brought to the current version: the text to store. Throws
 * ImportError when it does not parse, does not match the manifest, or is newer than this app.
 */
export function admitDocument(
  document: { path: string; schemaVersion: number },
  text: string,
): string {
  const type = DOCUMENT_TYPES.get(document.path);
  if (!type) throw refusedEntry(document.path);
  const decoded = decodeDocument(text, type);
  if (decoded.status === 'tooNew') throw new ImportError(TOO_NEW);
  if (decoded.status === 'corrupt') throw new ImportError(DAMAGED);
  // A Scene whose Notes cannot be read parses with empty Notes (core/scenes.ts); an Export never
  // holds one, so the zip was changed: refuse it rather than lose those Notes unseen.
  if (isRecord(decoded.value) && 'unreadableNotes' in decoded.value) {
    throw new ImportError(DAMAGED);
  }
  const stored: unknown = JSON.parse(text);
  if (!isRecord(stored) || stored.schemaVersion !== document.schemaVersion) {
    throw new ImportError(DAMAGED);
  }
  return encodeDocument(type, decoded.value);
}

const IMPORTED_SUFFIX = ' (importée)';

function sameName(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase('fr') === b.trim().toLocaleLowerCase('fr');
}

/**
 * Name of an imported Campaign: its own, with " (importée)" when a Campaign already has that
 * name (letter case ignored), kept within the longest name a Campaign may have.
 */
export function importedCampaignName(name: string, existingNames: readonly string[]): string {
  const own = name.trim() || 'Campagne';
  if (!existingNames.some((existing) => sameName(existing, own))) {
    return own.slice(0, MAX_CAMPAIGN_NAME_LENGTH).trim();
  }
  return `${own.slice(0, MAX_CAMPAIGN_NAME_LENGTH - IMPORTED_SUFFIX.length).trim()}${IMPORTED_SUFFIX}`;
}

/** Counts unpacked bytes against the most a zip may unpack to. */
function createBudget(limit: number) {
  let used = 0;
  return {
    take(bytes: number) {
      used += bytes;
      if (used > limit) throw new ImportError(TOO_BIG);
    },
  };
}
type Budget = ReturnType<typeof createBudget>;

/** The UTF-8 text of an entry, refused past `limit` bytes. */
async function readText(
  entry: ArchiveFile,
  limit: number,
  budget: Budget,
  signal: AbortSignal | undefined,
): Promise<string> {
  if (entry.declaredSize > limit) throw new ImportError(TOO_BIG);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of await entry.open()) {
    signal?.throwIfAborted();
    size += chunk.byteLength;
    if (size > limit) throw new ImportError(TOO_BIG);
    budget.take(chunk.byteLength);
    chunks.push(chunk);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    throw new ImportError(DAMAGED);
  }
}

/** Streams a Media entry to `file`, checking its size and content hash as it goes. */
async function unpackMedia(
  entry: ArchiveFile,
  media: Extract<CheckedEntry, { role: 'media' }>,
  file: string,
  context: { budget: Budget; signal?: AbortSignal; onBytes: (bytes: number) => void },
): Promise<void> {
  const { budget, signal, onBytes } = context;
  const hash = createHash('sha256');
  let size = 0;
  const content = await entry.open();
  async function* checked() {
    for await (const chunk of content) {
      size += chunk.byteLength;
      if (size > media.size) throw new ImportError(DAMAGED);
      budget.take(chunk.byteLength);
      hash.update(chunk);
      yield chunk;
      onBytes(chunk.byteLength);
    }
  }
  // 'wx': never writes over a file, even one a rule missed.
  await pipeline(checked(), createWriteStream(file, { flags: 'wx' }), { signal });
  if (size !== media.size || hash.digest('hex') !== media.contentHash) {
    throw new ImportError(DAMAGED);
  }
}

/** Unpacks and checks every entry into `staging`; returns the documents' texts to store. */
async function unpack(
  archive: ReadArchive,
  staging: string,
  signal: AbortSignal | undefined,
  onProgress: ((progress: ImportProgress) => void) | undefined,
): Promise<Map<string, string>> {
  if (archive.entryCount > MAX_ARCHIVE_ENTRIES) throw new ImportError(TOO_BIG);
  const budget = createBudget(unpackLimit(archive.archiveBytes));
  const documents = new Map<string, string>();
  let checker: EntryChecker | undefined;
  let entries = 0;
  let doneBytes = 0;
  let totalBytes = 0;

  for await (const entry of archive.entries()) {
    signal?.throwIfAborted();
    if (++entries > MAX_ARCHIVE_ENTRIES) throw new ImportError(TOO_BIG);
    if (!checker) {
      if (entry.path !== EXPORT_MANIFEST_FILE || entry.kind !== 'file') {
        throw new ImportError(NOT_AN_EXPORT);
      }
      const manifest = parseExportManifest(
        await readText(entry, MAX_MANIFEST_BYTES, budget, signal),
      );
      totalBytes = manifest.media.reduce((sum, file) => sum + file.size, 0);
      if (totalBytes > unpackLimit(archive.archiveBytes)) throw new ImportError(TOO_BIG);
      checker = createEntryChecker(manifest);
      onProgress?.({ doneBytes, totalBytes });
      continue;
    }
    const checked = checker.check(entry);
    switch (checked.role) {
      case 'folder':
        break;
      case 'document':
        documents.set(
          checked.path,
          admitDocument(checked, await readText(entry, MAX_DOCUMENT_BYTES, budget, signal)),
        );
        break;
      case 'media': {
        const file = path.join(staging, MEDIA_FOLDER, checked.fileName);
        if (path.dirname(file) !== path.join(staging, MEDIA_FOLDER)) throw refusedEntry(entry.path);
        await unpackMedia(entry, checked, file, {
          budget,
          signal,
          onBytes(bytes) {
            doneBytes += bytes;
            onProgress?.({ doneBytes, totalBytes });
          },
        });
        break;
      }
    }
  }
  if (!checker) throw new ImportError(NOT_AN_EXPORT);
  checker.finish();
  return documents;
}

async function exists(file: string): Promise<boolean> {
  try {
    await fsp.lstat(file);
    return true;
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * Imports the zip `openArchive` opens as a new Campaign in `campaignsFolder`, and returns it.
 * The zip is unpacked and checked in a staging folder under `importsFolder` (on the same disk,
 * so the final move is one rename). `existingNames` are the Campaigns' names, for the
 * " (importée)" suffix. Progress is in Media bytes unpacked; `signal` cancels. On any failure,
 * nothing is left behind.
 */
export async function importCampaign(input: {
  openArchive: OpenArchive;
  campaignsFolder: string;
  importsFolder: string;
  existingNames: readonly string[];
  newId?: () => CampaignId;
  signal?: AbortSignal;
  onProgress?: (progress: ImportProgress) => void;
}): Promise<{ id: CampaignId; name: string }> {
  const { campaignsFolder, importsFolder, signal } = input;
  const newId = input.newId ?? randomUUID;
  signal?.throwIfAborted();
  await fsp.mkdir(importsFolder, { recursive: true });
  const staging = await fsp.mkdtemp(path.join(importsFolder, 'import-'));
  try {
    await fsp.mkdir(path.join(staging, MEDIA_FOLDER));
    const archive = await input.openArchive();
    let documents: Map<string, string>;
    try {
      documents = await unpack(archive, staging, signal, input.onProgress);
    } finally {
      archive.close();
    }

    const campaignText = documents.get(CAMPAIGN_FILE);
    const campaign =
      campaignText === undefined ? undefined : decodeDocument(campaignText, campaignDocument);
    if (campaign?.status !== 'ok') throw new ImportError(DAMAGED);
    const name = importedCampaignName(campaign.value.name, input.existingNames);
    documents.set(CAMPAIGN_FILE, encodeDocument(campaignDocument, { ...campaign.value, name }));
    for (const [documentPath, text] of documents) {
      await fsp.writeFile(path.join(staging, documentPath), text, { encoding: 'utf8', flag: 'wx' });
    }

    signal?.throwIfAborted();
    const id = newId();
    await fsp.mkdir(campaignsFolder, { recursive: true });
    const target = path.join(campaignsFolder, id);
    // Import never overwrites: a Campaign already there keeps its folder.
    if (await exists(target)) throw new ImportError('Une campagne porte déjà cet identifiant.');
    await nodeFileSystem.rename(staging, target);
    return { id, name };
  } catch (error) {
    await fsp.rm(staging, { recursive: true, force: true, maxRetries: 5 });
    throw error;
  }
}

/** Removes staging folders an Import interrupted by a crash left behind. */
export async function clearImportLeftovers(importsFolder: string): Promise<void> {
  await fsp.rm(importsFolder, { recursive: true, force: true, maxRetries: 5 });
}
