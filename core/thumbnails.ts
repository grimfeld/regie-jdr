/**
 * Library thumbnails: small PNG copies of image Media, so the library never loads full-size
 * images. No Electron dependency: the pixels are made by an ImageResizer the main process gives
 * (electron/imageResizer.ts), and tests pass a fake.
 *
 * On disk, in the Campaign's folder, next to the Media files:
 *   thumbnails/<sha256>.png   one per image content, named by the Media's content hash
 *
 * A thumbnail is made at import and made again whenever it is asked for and missing.
 */
import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Media } from '../shared/domain.js';
import { mediaFileName } from './mediaAddress.js';
import { createKeyedSerialQueue } from './serialQueue.js';

/** Turns an image file into thumbnail pixels. The main process implements it. */
export interface ImageResizer {
  /**
   * PNG bytes of the image in `sourceFile`, scaled to fit a `maxEdge` × `maxEdge` square with
   * its proportions kept, never enlarged. Throws when the file cannot be decoded.
   */
  thumbnail(sourceFile: string, maxEdge: number): Promise<Uint8Array>;
}

/** Longest side of a thumbnail, in pixels: sharp in a library cell on a high-density screen. */
export const THUMBNAIL_MAX_EDGE = 320;

export const THUMBNAIL_FOLDER = 'thumbnails';
const MEDIA_FOLDER = 'media';

/** Name of a Media's thumbnail in its Campaign's thumbnails folder. */
export function thumbnailFileName(media: Pick<Media, 'contentHash'>): string {
  return `${media.contentHash}.png`;
}

/**
 * Size of the thumbnail of a `width` × `height` image: fits in `maxEdge` × `maxEdge`,
 * proportions kept, never enlarged, never below one pixel.
 */
export function thumbnailSize(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function exists(file: string): Promise<boolean> {
  try {
    return (await fsp.stat(file)).isFile();
  } catch {
    return false;
  }
}

export interface Thumbnails {
  /**
   * The thumbnail file of an image Media in `campaignFolder`, made now if it is missing.
   * Undefined when the Media's own file is missing: there is nothing to show.
   * Throws when the resizer cannot read the image.
   */
  ensure(
    campaignFolder: string,
    media: Pick<Media, 'contentHash' | 'extension'>,
  ): Promise<string | undefined>;
  /** Deletes a Media's thumbnail, if there is one. */
  remove(campaignFolder: string, media: Pick<Media, 'contentHash'>): Promise<void>;
}

export function createThumbnails(resizer: ImageResizer): Thumbnails {
  /** One generation at a time per thumbnail file: concurrent requests make it once. */
  const serialized = createKeyedSerialQueue<string>();

  return {
    ensure(campaignFolder, media) {
      const target = path.join(campaignFolder, THUMBNAIL_FOLDER, thumbnailFileName(media));
      return serialized(target, async () => {
        const source = path.join(campaignFolder, MEDIA_FOLDER, mediaFileName(media));
        if (!(await exists(source))) return undefined;
        if (await exists(target)) return target;
        const pixels = await resizer.thumbnail(source, THUMBNAIL_MAX_EDGE);
        await fsp.mkdir(path.dirname(target), { recursive: true });
        // Write then rename: an interrupted write never leaves a half-written thumbnail.
        const partial = `${target}.${randomUUID()}.tmp`;
        await fsp.writeFile(partial, pixels);
        await fsp.rename(partial, target);
        return target;
      });
    },

    async remove(campaignFolder, media) {
      await fsp.rm(path.join(campaignFolder, THUMBNAIL_FOLDER, thumbnailFileName(media)), {
        force: true,
      });
    },
  };
}
