/**
 * The Media manager: a Campaign's library of imported images and audio. No Electron
 * dependency.
 *
 * On disk, in the Campaign's folder:
 *   media/<sha256><extension>   the files, named by content hash (one copy per content)
 *   media.json                  the Media index ({ media: Media[] }, versioned document; it
 *                               holds each Media's favourite flag too, so an Export carries it)
 *   thumbnails/<sha256>.png     library thumbnails of the images (core/thumbnails.ts)
 *
 * Deduplication is per Campaign: the same file imported into two Campaigns is stored in both.
 * An audio Media's duration is read from its file at import (core/audioDuration.ts).
 * Errors meant for the Game Master are MediaError with a French message.
 */
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, type Dirent } from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { MediaImportKind, MediaImportResult } from '../shared/contract.js';
import type {
  AudioMedia,
  AudioRole,
  CampaignId,
  ImageCategory,
  ImageMedia,
  Media,
  MediaId,
} from '../shared/domain.js';
import { readAudioDuration } from './audioDuration.js';
import { CampaignError } from './campaigns.js';
import { isRecord } from './guards.js';
import {
  extensionsOf,
  imageExtensionOfContent,
  isMediaExtension,
  MAX_PASTED_IMAGE_BYTES,
  MEDIA_FILE_TYPES,
  mediaFileName,
  parseMediaAddress,
} from './mediaAddress.js';
import { createKeyedSerialQueue } from './serialQueue.js';
import type { Logger } from './logger.js';
import { createThumbnails, type ImageResizer } from './thumbnails.js';
import type { DocumentType, Storage } from './storage/index.js';

export class MediaError extends Error {}

export interface MediaLibrary {
  /** The Campaign's Media, in import order. */
  list(campaignId: CampaignId): Promise<Media[]>;
  import(
    campaignId: CampaignId,
    files: readonly string[],
    kind: MediaImportKind,
  ): Promise<MediaImportResult>;
  /**
   * Imports an image pasted into the Notes, as a Reference image. `data` and `name` are
   * untrusted: the type is read from the content (PNG, JPEG or WebP; anything else is refused,
   * as is content larger than MAX_PASTED_IMAGE_BYTES), and the name only names the Media
   * (`pastedImageName`). Content already in the library gives its Media, unchanged.
   */
  importPasted(campaignId: CampaignId, data: Uint8Array, name: string): Promise<MediaImportResult>;
  /** Changes an image's category. Audio has a role instead, fixed at import. */
  setImageCategory(
    campaignId: CampaignId,
    mediaId: MediaId,
    category: ImageCategory,
  ): Promise<Media>;
  /**
   * Changes the name a Media is shown under. Its original file name is kept. Fails with a
   * French message for an empty or too long name.
   */
  rename(campaignId: CampaignId, mediaId: MediaId, name: string): Promise<Media>;
  /** Stars (`favourite` true) or unstars an image or a sound, for the "Favoris" filter. */
  setFavourite(campaignId: CampaignId, mediaId: MediaId, favourite: boolean): Promise<Media>;
  /**
   * Removes a Media from the library and deletes its file and thumbnail. Scenes are not touched: removing
   * their placements first is the caller's job (core/onAirCommands.ts).
   */
  delete(campaignId: CampaignId, mediaId: MediaId): Promise<void>;
  /** Files in the Campaign's media folder that no Media refers to (file names). */
  listOrphanFiles(campaignId: CampaignId): Promise<string[]>;
  /**
   * The file and content type a Media or thumbnail address serves, or undefined (a 404) when
   * the address is malformed, its Campaign is not the open Campaign (`openCampaignId`, null when
   * none is open), its Media file does not exist, or it points outside the media folder.
   * A missing thumbnail of an existing image is made again first; that throws when the image
   * cannot be decoded.
   */
  resolveAddress(
    url: string,
    openCampaignId: CampaignId | null,
  ): Promise<{ file: string; mimeType: string } | undefined>;
}

export const IMAGE_CATEGORIES: readonly ImageCategory[] = ['scenery', 'character', 'reference'];
export const AUDIO_ROLES: readonly AudioRole[] = ['music', 'soundEffect', 'ambience'];

export function isImageCategory(value: unknown): value is ImageCategory {
  return typeof value === 'string' && (IMAGE_CATEGORIES as readonly string[]).includes(value);
}

export function isAudioRole(value: unknown): value is AudioRole {
  return typeof value === 'string' && (AUDIO_ROLES as readonly string[]).includes(value);
}

/** Longest Media name; longer ones are refused. */
export const MAX_MEDIA_NAME_LENGTH = 100;

/** A Media name as stored: trimmed. Throws a MediaError for an empty or too long one. */
export function validateMediaName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === '') throw new MediaError('Le nom du média ne peut pas être vide.');
  if (trimmed.length > MAX_MEDIA_NAME_LENGTH) {
    throw new MediaError(
      `Le nom du média est trop long (${MAX_MEDIA_NAME_LENGTH} caractères au plus).`,
    );
  }
  return trimmed;
}

/** What a pasted image is named when its name says nothing (Chromium names screenshots so). */
const PASTED_IMAGE_NAME = 'Image collée';

/**
 * The name of a pasted image's Media, from the pasted file's untrusted name: its last path
 * segment without extension, without the characters a Windows file name refuses, at most
 * MAX_MEDIA_NAME_LENGTH long; "Image collée" when nothing is left or it is Chromium's "image".
 */
export function pastedImageName(name: string): string {
  const fileName = name.split(/[\\/]/).pop() ?? '';
  const dot = fileName.lastIndexOf('.');
  const stem = (dot > 0 ? fileName.slice(0, dot) : fileName)
    // eslint-disable-next-line no-control-regex -- control characters are what is removed here
    .replace(/[<>:"|?*\u0000-\u001f]/g, '')
    .trim()
    .slice(0, MAX_MEDIA_NAME_LENGTH)
    .trim();
  return stem === '' || stem.toLowerCase() === 'image' ? PASTED_IMAGE_NAME : stem;
}

/** Category of a newly imported image, until the Game Master changes it. */
export const DEFAULT_IMAGE_CATEGORY: ImageCategory = 'scenery';

/** What differs between importing images and importing audio. */
export interface MediaKindRules {
  /** Accepted file extensions, lower-case, without the dot (file picker filters). */
  extensions: string[];
  /** Why a file of the other kind was refused, for the Game Master. */
  refusal(fileName: string): string;
  /** The native file picker for this kind. */
  picker: { title: string; filterName: string };
  /** The kind-specific fields of a newly imported Media, read from its file where needed. */
  defaults(
    kind: MediaImportKind,
    file: string,
  ): Promise<
    Pick<ImageMedia, 'kind' | 'category'> | Pick<AudioMedia, 'kind' | 'role' | 'durationSeconds'>
  >;
}

/** One entry per Media kind; looked up by the import's `accept`. */
export const MEDIA_KINDS: Record<Media['kind'], MediaKindRules> = {
  image: {
    extensions: extensionsOf('image'),
    refusal: (fileName) => `« ${fileName} » n’a pas été importé : ce n’est pas une image.`,
    picker: { title: 'Importer des images', filterName: 'Images' },
    // Looked up by `accept`, so this is always an image import.
    defaults: (kind) =>
      Promise.resolve({
        kind: 'image',
        category:
          (kind as Extract<MediaImportKind, { accept: 'image' }>).category ??
          DEFAULT_IMAGE_CATEGORY,
      }),
  },
  audio: {
    extensions: extensionsOf('audio'),
    refusal: (fileName) => `« ${fileName} » n’a pas été importé : ce n’est pas un son.`,
    picker: { title: 'Importer des sons', filterName: 'Sons' },
    // Looked up by `accept`, so this is always an audio import.
    defaults: async (kind, file) => ({
      kind: 'audio',
      role: (kind as Extract<MediaImportKind, { accept: 'audio' }>).role,
      durationSeconds: (await readAudioDuration(file)) ?? null,
    }),
  },
};

const MEDIA_FOLDER = 'media';
const INDEX_FILE = 'media.json';

function parseMedia(value: unknown, campaignId: CampaignId): Media | undefined {
  if (!isRecord(value)) return undefined;
  const { id, contentHash, originalName, name, extension, favourite, kind } = value;
  if (typeof id !== 'string' || typeof contentHash !== 'string') return undefined;
  if (!/^[0-9a-f]{64}$/.test(contentHash)) return undefined;
  if (typeof originalName !== 'string' || typeof name !== 'string') return undefined;
  if (typeof extension !== 'string' || !isMediaExtension(extension)) return undefined;
  if (typeof favourite !== 'boolean') return undefined;
  const base = { id, campaignId, contentHash, originalName, name, extension, favourite };
  if (kind === 'image' && isImageCategory(value.category)) {
    return { ...base, kind, category: value.category };
  }
  if (kind === 'audio' && isAudioRole(value.role) && isDuration(value.durationSeconds)) {
    return { ...base, kind, role: value.role, durationSeconds: value.durationSeconds };
  }
  return undefined;
}

function isDuration(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value > 0);
}

/**
 * Version 1 to 2 (Milestone 2): audio Media gain a duration. Reading it needs the file, so
 * Media imported before have none (null) until their file is imported again.
 */
function migrateMediaIndexV1(fields: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(fields.media)) return fields;
  const media = fields.media.map((item: unknown) =>
    isRecord(item) && item.kind === 'audio' ? { ...item, durationSeconds: null } : item,
  );
  return { ...fields, media };
}

/**
 * Version 2 to 3 (Milestone 3): images may be in the Reference category. Nothing to change: the
 * version only keeps an older app from reading a category it does not know.
 */
function migrateMediaIndexV2(fields: Record<string, unknown>): Record<string, unknown> {
  return fields;
}

/**
 * Version 3 to 4 (Milestone 4): Media gain a favourite flag. Nothing was starred before, so every
 * Media gets none.
 */
function migrateMediaIndexV3(fields: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(fields.media)) return fields;
  const media = fields.media.map((item: unknown) =>
    isRecord(item) ? { ...item, favourite: false } : item,
  );
  return { ...fields, media };
}

/** The index stores Media without their Campaign id: it is the folder's. */
type StoredMedia = Omit<Media, 'campaignId'>;

export const mediaIndexDocument: DocumentType<{ media: StoredMedia[] }> = {
  name: 'media',
  version: 4,
  migrations: { 1: migrateMediaIndexV1, 2: migrateMediaIndexV2, 3: migrateMediaIndexV3 },
  parse({ media }) {
    if (!Array.isArray(media)) return undefined;
    const parsed = media.map((item) => parseMedia(item, ''));
    if (parsed.some((item) => item === undefined)) return undefined;
    return {
      media: (parsed as Media[]).map(({ campaignId: _campaignId, ...stored }) => stored),
    };
  },
};

async function sha256Of(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function exists(file: string): Promise<boolean> {
  try {
    return (await fsp.stat(file)).isFile();
  } catch {
    return false;
  }
}

/** Copies a picked file into the media folder, unless its file is already there. */
async function storeFile(source: string, mediaFolder: string, media: Media): Promise<void> {
  const target = path.join(mediaFolder, mediaFileName(media));
  if (await exists(target)) return;
  await fsp.mkdir(mediaFolder, { recursive: true });
  // Copy then rename: an interrupted import never leaves a half-written Media file.
  const partial = `${target}.${randomUUID()}.tmp`;
  await fsp.copyFile(source, partial);
  await fsp.rename(partial, target);
}

/**
 * `resizer` makes the library thumbnails (core/thumbnails.ts); `log` hears of a thumbnail that
 * could not be made at import (nothing is logged without it).
 */
export function createMediaLibrary(
  storage: Storage,
  resizer: ImageResizer,
  options: { log?: Pick<Logger, 'warn'> } = {},
): MediaLibrary {
  const { log } = options;
  /** Serializes the read-modify-write of each Campaign's index. */
  const serialized = createKeyedSerialQueue<CampaignId>();
  const thumbnails = createThumbnails(resizer);

  /**
   * Makes an imported image's thumbnail if it is missing. A failure does not fail the import:
   * it is logged, and the thumbnail is made again when the library asks for it.
   */
  async function prepareThumbnail(folder: string, media: Media): Promise<void> {
    if (media.kind !== 'image') return;
    await thumbnails.ensure(folder, media).catch((error: unknown) => {
      log?.warn(`Could not make the thumbnail of imported image ${media.id}`, error);
    });
  }

  async function campaignFolder(campaignId: CampaignId): Promise<string> {
    if (!(await storage.campaigns.get(campaignId))) {
      throw new CampaignError('Cette campagne n’existe plus.');
    }
    return storage.campaignFolder(campaignId);
  }

  async function readIndex(folder: string, campaignId: CampaignId): Promise<Media[]> {
    const index = await storage.documents.read(path.join(folder, INDEX_FILE), mediaIndexDocument);
    return (index?.media ?? []).map((stored) => ({ ...stored, campaignId }) as Media);
  }

  async function writeIndex(folder: string, media: Media[]): Promise<void> {
    await storage.documents.write(path.join(folder, INDEX_FILE), mediaIndexDocument, {
      media: media.map(({ campaignId: _campaignId, ...stored }) => stored),
    });
  }

  /**
   * Changes one Media of the index and saves it; fails with a French message when the Media no
   * longer exists, or with what `change` throws.
   */
  function updateMedia(
    campaignId: CampaignId,
    mediaId: MediaId,
    change: (media: Media) => Media,
  ): Promise<Media> {
    return serialized(campaignId, async () => {
      const folder = await campaignFolder(campaignId);
      const library = await readIndex(folder, campaignId);
      const index = library.findIndex((media) => media.id === mediaId);
      if (index < 0) throw new MediaError('Ce média n’existe plus.');
      const updated = change(library[index]);
      library[index] = updated;
      await writeIndex(folder, library);
      return updated;
    });
  }

  /** A file to import: where it is, what the Game Master knows it as, what its Media is named. */
  interface Source {
    file: string;
    fileName: string;
    originalName: string;
  }

  function importSources(
    campaignId: CampaignId,
    sources: readonly Source[],
    kind: MediaImportKind,
  ): Promise<MediaImportResult> {
    return serialized(campaignId, async () => {
      const folder = await campaignFolder(campaignId);
      const library = await readIndex(folder, campaignId);
      const mediaFolder = path.join(folder, MEDIA_FOLDER);
      const result: MediaImportResult = { imported: [], refused: [] };
      const rules = MEDIA_KINDS[kind.accept];
      let changed = false;
      for (const { file: source, fileName, originalName } of sources) {
        const extension = path.extname(source).toLowerCase();
        const type = isMediaExtension(extension) ? MEDIA_FILE_TYPES[extension] : undefined;
        if (!type) {
          result.refused.push(
            `« ${fileName} » n’a pas été importé : ce type de fichier n’est pas pris en charge (images PNG, JPEG, WebP ; sons MP3, WAV, OGG, FLAC, M4A).`,
          );
          continue;
        }
        if (type.kind !== kind.accept) {
          result.refused.push(rules.refusal(fileName));
          continue;
        }
        if (!(await exists(source))) {
          result.refused.push(
            `« ${fileName} » n’a pas été importé : ce n’est pas un fichier lisible.`,
          );
          continue;
        }
        const contentHash = await sha256Of(source);
        const existingIndex = library.findIndex((media) => media.contentHash === contentHash);
        if (existingIndex >= 0) {
          // Same content again: no second Media. Puts its file back if it went missing.
          let existing = library[existingIndex];
          await storeFile(source, mediaFolder, existing);
          await prepareThumbnail(folder, existing);
          if (existing.kind === 'audio' && existing.durationSeconds === null) {
            // Imported before durations were recorded, or unreadable then: try again.
            const durationSeconds = (await readAudioDuration(source)) ?? null;
            if (durationSeconds !== null) {
              existing = { ...existing, durationSeconds };
              library[existingIndex] = existing;
              changed = true;
            }
          }
          result.imported.push(existing);
          continue;
        }
        const base = {
          id: randomUUID(),
          campaignId,
          contentHash,
          originalName,
          name: originalName,
          extension,
          favourite: false,
        };
        const media = { ...base, ...(await rules.defaults(kind, source)) } as Media;
        await storeFile(source, mediaFolder, media);
        await prepareThumbnail(folder, media);
        library.push(media);
        result.imported.push(media);
        changed = true;
      }
      if (changed) await writeIndex(folder, library);
      return result;
    });
  }

  return {
    async list(campaignId) {
      return readIndex(await campaignFolder(campaignId), campaignId);
    },

    import(campaignId, files, kind) {
      return importSources(
        campaignId,
        files.map((file) => ({
          file,
          fileName: path.basename(file),
          originalName: path.basename(file, path.extname(file)),
        })),
        kind,
      );
    },

    async importPasted(campaignId, data, name) {
      const extension = imageExtensionOfContent(data);
      const refused = (why: string) => ({
        imported: [],
        refused: [`« ${name} » n’a pas été importé : ${why}`],
      });
      if (!extension) return refused('ce n’est pas une image PNG, JPEG ou WebP.');
      if (data.byteLength > MAX_PASTED_IMAGE_BYTES) return refused('l’image est trop volumineuse.');
      // Imported from a file like any other, in a folder of its own named by the app only.
      const folder = await fsp.mkdtemp(path.join(os.tmpdir(), 'regie-paste-'));
      try {
        const file = path.join(folder, `collee${extension}`);
        await fsp.writeFile(file, data);
        return await importSources(
          campaignId,
          [{ file, fileName: name, originalName: pastedImageName(name) }],
          { accept: 'image', category: 'reference' },
        );
      } finally {
        await fsp.rm(folder, { recursive: true, force: true });
      }
    },

    setImageCategory(campaignId, mediaId, category) {
      return updateMedia(campaignId, mediaId, (media) => {
        if (media.kind !== 'image') {
          throw new MediaError(
            'Seules les images ont une catégorie ; le rôle d’un son ne change pas.',
          );
        }
        return { ...media, category };
      });
    },

    rename(campaignId, mediaId, name) {
      return updateMedia(campaignId, mediaId, (media) => ({
        ...media,
        name: validateMediaName(name),
      }));
    },

    setFavourite(campaignId, mediaId, favourite) {
      return updateMedia(campaignId, mediaId, (media) => ({ ...media, favourite }));
    },

    delete(campaignId, mediaId) {
      return serialized(campaignId, async () => {
        const folder = await campaignFolder(campaignId);
        const library = await readIndex(folder, campaignId);
        const media = library.find((item) => item.id === mediaId);
        if (!media) throw new MediaError('Ce média n’existe plus.');
        // Index first: a crash before the file goes leaves an orphan file, never a Media
        // without its file.
        await writeIndex(
          folder,
          library.filter((item) => item.id !== mediaId),
        );
        await fsp.rm(path.join(folder, MEDIA_FOLDER, mediaFileName(media)), { force: true });
        await thumbnails.remove(folder, media);
      });
    },

    async listOrphanFiles(campaignId) {
      const folder = await campaignFolder(campaignId);
      const known = new Set((await readIndex(folder, campaignId)).map(mediaFileName));
      let entries: Dirent[];
      try {
        entries = await fsp.readdir(path.join(folder, MEDIA_FOLDER), { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
      }
      return entries
        .filter((entry) => entry.isFile() && !known.has(entry.name))
        .map((entry) => entry.name)
        .sort();
    },

    async resolveAddress(url, openCampaignId) {
      const address = parseMediaAddress(url);
      if (address?.campaignId !== openCampaignId) return undefined;
      let folder: string;
      try {
        folder = storage.campaignFolder(address.campaignId);
      } catch {
        return undefined;
      }
      const type = MEDIA_FILE_TYPES[address.extension];
      if (address.thumbnail) {
        if (type.kind !== 'image') return undefined;
        const contentHash = address.fileName.slice(0, -address.extension.length);
        const file = await thumbnails.ensure(folder, { contentHash, extension: address.extension });
        return file === undefined ? undefined : { file, mimeType: 'image/png' };
      }
      const file = path.join(folder, MEDIA_FOLDER, address.fileName);
      if (!(await exists(file))) return undefined;
      return { file, mimeType: type.mimeType };
    },
  };
}
