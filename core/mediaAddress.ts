/**
 * Media file types and Media addresses. Pure (no Node or Electron import): the interface
 * imports `mediaAddress` from here too.
 *
 * A Media address is `regie-media://media/<campaignId>/<contentHash><extension>`. The Campaign
 * id is in the path, not the host, because a standard scheme lower-cases the host.
 * A thumbnail address is the same with the `thumbnail` host: it serves the library thumbnail of
 * that image Media (core/thumbnails.ts).
 */
import type { CampaignId, Media } from '../shared/domain.js';

export const MEDIA_SCHEME = 'regie-media';
const ADDRESS_HOST = 'media';
const THUMBNAIL_HOST = 'thumbnail';

/** The allowlist: every file type a Media can have, by lower-case extension. */
export const MEDIA_FILE_TYPES = {
  '.png': { kind: 'image', mimeType: 'image/png' },
  '.jpg': { kind: 'image', mimeType: 'image/jpeg' },
  '.jpeg': { kind: 'image', mimeType: 'image/jpeg' },
  '.webp': { kind: 'image', mimeType: 'image/webp' },
  '.mp3': { kind: 'audio', mimeType: 'audio/mpeg' },
  '.wav': { kind: 'audio', mimeType: 'audio/wav' },
  '.ogg': { kind: 'audio', mimeType: 'audio/ogg' },
  '.flac': { kind: 'audio', mimeType: 'audio/flac' },
  '.m4a': { kind: 'audio', mimeType: 'audio/mp4' },
} as const satisfies Record<string, { kind: Media['kind']; mimeType: string }>;

export type MediaExtension = keyof typeof MEDIA_FILE_TYPES;

export function isMediaExtension(value: string): value is MediaExtension {
  return Object.prototype.hasOwnProperty.call(MEDIA_FILE_TYPES, value);
}

/** Extensions of one kind, without the dot (for file picker filters). */
export function extensionsOf(kind: Media['kind']): string[] {
  return Object.entries(MEDIA_FILE_TYPES)
    .filter(([, type]) => type.kind === kind)
    .map(([extension]) => extension.slice(1));
}

/**
 * The kind of Media a file would be, from its name's extension (any case), or undefined for a
 * type that is not allowlisted. The library uses it to ask for a role only when sounds are
 * dropped; the import checks the type again.
 */
export function mediaKindOfFileName(fileName: string): Media['kind'] | undefined {
  const dot = fileName.lastIndexOf('.');
  const extension = dot < 0 ? '' : fileName.slice(dot).toLowerCase();
  return isMediaExtension(extension) ? MEDIA_FILE_TYPES[extension].kind : undefined;
}

/** Largest image pasted into the Notes, in bytes: larger ones are refused. */
export const MAX_PASTED_IMAGE_BYTES = 50 * 1024 * 1024;

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

const ascii = (text: string) => Array.from(text, (letter) => letter.charCodeAt(0));

/**
 * The allowlisted image type of some content, read from its first bytes (PNG, JPEG or WebP), as
 * the extension a Media of it gets; undefined for anything else. For content that comes with no
 * trustworthy name: an image pasted from the clipboard.
 */
export function imageExtensionOfContent(bytes: Uint8Array): MediaExtension | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return '.png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return '.jpg';
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return '.webp';
  return undefined;
}

/** Name of a Media's file in its Campaign's media folder. */
export function mediaFileName(media: Pick<Media, 'contentHash' | 'extension'>): string {
  return `${media.contentHash}${media.extension}`;
}

type Addressable = Pick<Media, 'campaignId' | 'contentHash' | 'extension'>;

function addressOn(host: string, media: Addressable): string {
  return `${MEDIA_SCHEME}://${host}/${encodeURIComponent(media.campaignId)}/${mediaFileName(media)}`;
}

/** Address the windows load a Media from. */
export function mediaAddress(media: Addressable) {
  return addressOn(ADDRESS_HOST, media);
}

/** Address the library loads an image Media's thumbnail from. */
export function thumbnailAddress(media: Addressable) {
  return addressOn(THUMBNAIL_HOST, media);
}

/** A Media file name: a lower-case SHA-256 in hex plus an allowlisted extension. */
const FILE_NAME = /^[0-9a-f]{64}(\.[a-z0-9]+)$/;

/**
 * The Campaign and Media file a Media or thumbnail address points to (`thumbnail` tells which),
 * or undefined for anything that is not a well-formed address (other host, extra path segments,
 * `..`, disallowed extension).
 */
export function parseMediaAddress(url: string):
  | {
      campaignId: CampaignId;
      fileName: string;
      extension: MediaExtension;
      thumbnail: boolean;
    }
  | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== `${MEDIA_SCHEME}:`) return undefined;
  if (parsed.host !== ADDRESS_HOST && parsed.host !== THUMBNAIL_HOST) return undefined;
  const segments = parsed.pathname.split('/');
  if (segments.length !== 3 || segments[0] !== '') return undefined;
  let campaignId: string;
  let fileName: string;
  try {
    campaignId = decodeURIComponent(segments[1]);
    fileName = decodeURIComponent(segments[2]);
  } catch {
    return undefined;
  }
  const extension = FILE_NAME.exec(fileName)?.[1];
  if (!extension || !isMediaExtension(extension)) return undefined;
  // The Campaign id is checked by the storage when it turns it into a folder.
  return { campaignId, fileName, extension, thumbnail: parsed.host === THUMBNAIL_HOST };
}
