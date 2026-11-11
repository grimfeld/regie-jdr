import fs from 'node:fs/promises';
import type { ImageResizer } from '../../core/thumbnails';

/**
 * An ImageResizer that "resizes" by copying the source bytes after a marker, and records each
 * call. Sources whose content is in `undecodable` fail like an image that cannot be read.
 */
export function fakeResizer(undecodable: readonly string[] = []) {
  const calls: { sourceFile: string; maxEdge: number }[] = [];
  const resizer: ImageResizer = {
    async thumbnail(sourceFile, maxEdge) {
      calls.push({ sourceFile, maxEdge });
      const content = await fs.readFile(sourceFile, 'utf8');
      if (undecodable.includes(content)) throw new Error('not an image');
      return Buffer.from(`thumbnail of ${content}`);
    },
  };
  return { resizer, calls };
}
