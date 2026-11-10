/**
 * Library thumbnails made with Electron's own image facilities (no native image module,
 * ADR-0001's reasons). The library logic is in core/thumbnails.ts.
 */
import { nativeImage, type NativeImage } from 'electron';
import { thumbnailSize, type ImageResizer } from '../core/thumbnails.js';

/**
 * The decoded image. nativeImage reads PNG and JPEG only; anything else (WebP) goes through the
 * operating system's thumbnail provider, which returns it already scaled to fit `maxEdge`.
 */
async function decode(sourceFile: string, maxEdge: number): Promise<NativeImage> {
  const image = nativeImage.createFromPath(sourceFile);
  if (!image.isEmpty()) return image;
  return nativeImage.createThumbnailFromPath(sourceFile, { width: maxEdge, height: maxEdge });
}

export const electronImageResizer: ImageResizer = {
  async thumbnail(sourceFile, maxEdge) {
    const image = await decode(sourceFile, maxEdge);
    if (image.isEmpty()) throw new Error(`Cannot decode the image ${sourceFile}`);
    const { width, height } = image.getSize();
    const size = thumbnailSize(width, height, maxEdge);
    const scaled =
      size.width === width && size.height === height
        ? image
        : image.resize({ ...size, quality: 'good' });
    return scaled.toPNG();
  },
};
