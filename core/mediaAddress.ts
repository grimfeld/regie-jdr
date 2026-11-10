/**
 * Media file types and Media addresses. Pure (no Node or Electron import): the interface
 * imports `mediaAddress` from here too.
 *
 * A Media address is `regie-asset://media/<campaignId>/<contentHash><extension>`. The Campaign
 * id is in the path, not the host, because a standard scheme lower-cases the host.
 */
import type { CampaignId, Media } from '../shared/domain.js';

export const MEDIA_SCHEME = 'regie-asset';
const ADDRESS_HOST = 'media';

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

/** Name of a Media's file in its Campaign's media folder. */
export function mediaFileName(media: Pick<Media, 'contentHash' | 'extension'>): string {
  return `${media.contentHash}${media.extension}`;
}

/** Address the windows load a Media from. */
export function mediaAddress(media: Pick<Media, 'campaignId' | 'contentHash' | 'extension'>) {
  return `${MEDIA_SCHEME}://${ADDRESS_HOST}/${encodeURIComponent(media.campaignId)}/${mediaFileName(media)}`;
}

/** A Media file name: a lower-case SHA-256 in hex plus an allowlisted extension. */
const FILE_NAME = /^[0-9a-f]{64}(\.[a-z0-9]+)$/;

/**
 * The Campaign and file a Media address points to, or undefined for anything that is not a
 * well-formed Media address (other host, extra path segments, `..`, disallowed extension).
 */
export function parseMediaAddress(
  url: string,
): { campaignId: CampaignId; fileName: string; extension: MediaExtension } | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== `${MEDIA_SCHEME}:` || parsed.host !== ADDRESS_HOST) return undefined;
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
  return { campaignId, fileName, extension };
}
