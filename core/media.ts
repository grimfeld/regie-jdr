/**
 * The Media manager: a Campaign's library of imported images and audio. No Electron
 * dependency.
 *
 * On disk, in the Campaign's folder:
 *   media/<sha256><extension>   the files, named by content hash (one copy per content)
 *   media.json                  the Media index ({ media: Media[] }, versioned document)
 *   thumbnails/<sha256>.png     library thumbnails of the images (core/thumbnails.ts)
 *
 * Deduplication is per Campaign: the same file imported into two Campaigns is stored in both.
 * Errors meant for the Game Master are MediaError with a French message.
 */
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, type Dirent } from 'node:fs';
import fsp from 'node:fs/promises';
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
import { CampaignError } from './campaigns.js';
import { isRecord } from './guards.js';
import {
  extensionsOf,
  isMediaExtension,
  MEDIA_FILE_TYPES,
  mediaFileName,
  parseMediaAddress,
} from './mediaAddress.js';
import { createKeyedSerialQueue } from './serialQueue.js';
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

export const IMAGE_CATEGORIES: readonly ImageCategory[] = ['scenery', 'character'];
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
  /** The kind-specific fields of a newly imported Media. */
  defaults(
    kind: MediaImportKind,
  ): Pick<ImageMedia, 'kind' | 'category'> | Pick<AudioMedia, 'kind' | 'role'>;
}

/** One entry per Media kind; looked up by the import's `accept`. */
export const MEDIA_KINDS: Record<Media['kind'], MediaKindRules> = {
  image: {
    extensions: extensionsOf('image'),
    refusal: (fileName) => `« ${fileName} » n’a pas été importé : ce n’est pas une image.`,
    picker: { title: 'Importer des images', filterName: 'Images' },
    defaults: () => ({ kind: 'image', category: DEFAULT_IMAGE_CATEGORY }),
  },
  audio: {
    extensions: extensionsOf('audio'),
    refusal: (fileName) => `« ${fileName} » n’a pas été importé : ce n’est pas un son.`,
    picker: { title: 'Importer des sons', filterName: 'Sons' },
    // Looked up by `accept`, so this is always an audio import.
    defaults: (kind) => ({
      kind: 'audio',
      role: (kind as Extract<MediaImportKind, { accept: 'audio' }>).role,
    }),
  },
};

const MEDIA_FOLDER = 'media';
const INDEX_FILE = 'media.json';

function parseMedia(value: unknown, campaignId: CampaignId): Media | undefined {
  if (!isRecord(value)) return undefined;
  const { id, contentHash, originalName, name, extension, kind } = value;
  if (typeof id !== 'string' || typeof contentHash !== 'string') return undefined;
  if (!/^[0-9a-f]{64}$/.test(contentHash)) return undefined;
  if (typeof originalName !== 'string' || typeof name !== 'string') return undefined;
  if (typeof extension !== 'string' || !isMediaExtension(extension)) return undefined;
  const base = { id, campaignId, contentHash, originalName, name, extension };
  if (kind === 'image' && isImageCategory(value.category)) {
    return { ...base, kind, category: value.category };
  }
  if (kind === 'audio' && isAudioRole(value.role)) return { ...base, kind, role: value.role };
  return undefined;
}

/** The index stores Media without their Campaign id: it is the folder's. */
type StoredMedia = Omit<Media, 'campaignId'>;

const mediaIndexDocument: DocumentType<{ media: StoredMedia[] }> = {
  name: 'media',
  version: 1,
  migrations: {},
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

/** `resizer` makes the library thumbnails (core/thumbnails.ts). */
export function createMediaLibrary(storage: Storage, resizer: ImageResizer): MediaLibrary {
  /** Serializes the read-modify-write of each Campaign's index. */
  const serialized = createKeyedSerialQueue<CampaignId>();
  const thumbnails = createThumbnails(resizer);

  /**
   * Makes an imported image's thumbnail if it is missing. A failure does not fail the import:
   * the thumbnail is made again when the library asks for it, and that failure is logged.
   */
  async function prepareThumbnail(folder: string, media: Media): Promise<void> {
    if (media.kind !== 'image') return;
    await thumbnails.ensure(folder, media).catch(() => undefined);
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

  return {
    async list(campaignId) {
      return readIndex(await campaignFolder(campaignId), campaignId);
    },

    import(campaignId, files, kind) {
      return serialized(campaignId, async () => {
        const folder = await campaignFolder(campaignId);
        const library = await readIndex(folder, campaignId);
        const mediaFolder = path.join(folder, MEDIA_FOLDER);
        const result: MediaImportResult = { imported: [], refused: [] };
        const rules = MEDIA_KINDS[kind.accept];
        let changed = false;
        for (const source of files) {
          const extension = path.extname(source).toLowerCase();
          const fileName = path.basename(source);
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
          const contentHash = await sha256Of(source);
          const existing = library.find((media) => media.contentHash === contentHash);
          if (existing) {
            // Same content again: no second Media. Puts its file back if it went missing.
            await storeFile(source, mediaFolder, existing);
            await prepareThumbnail(folder, existing);
            result.imported.push(existing);
            continue;
          }
          const originalName = path.basename(source, path.extname(source));
          const base = {
            id: randomUUID(),
            campaignId,
            contentHash,
            originalName,
            name: originalName,
            extension,
          };
          const media = { ...base, ...rules.defaults(kind) } as Media;
          await storeFile(source, mediaFolder, media);
          await prepareThumbnail(folder, media);
          library.push(media);
          result.imported.push(media);
          changed = true;
        }
        if (changed) await writeIndex(folder, library);
        return result;
      });
    },

    setImageCategory(campaignId, mediaId, category) {
      return serialized(campaignId, async () => {
        const folder = await campaignFolder(campaignId);
        const library = await readIndex(folder, campaignId);
        const index = library.findIndex((media) => media.id === mediaId);
        if (index < 0) throw new MediaError('Ce média n’existe plus.');
        const media = library[index];
        if (media.kind !== 'image') {
          throw new MediaError(
            'Seules les images ont une catégorie ; le rôle d’un son ne change pas.',
          );
        }
        const updated: Media = { ...media, category };
        library[index] = updated;
        await writeIndex(folder, library);
        return updated;
      });
    },

    rename(campaignId, mediaId, name) {
      return serialized(campaignId, async () => {
        const validName = validateMediaName(name);
        const folder = await campaignFolder(campaignId);
        const library = await readIndex(folder, campaignId);
        const index = library.findIndex((media) => media.id === mediaId);
        if (index < 0) throw new MediaError('Ce média n’existe plus.');
        const updated: Media = { ...library[index], name: validName };
        library[index] = updated;
        await writeIndex(folder, library);
        return updated;
      });
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
