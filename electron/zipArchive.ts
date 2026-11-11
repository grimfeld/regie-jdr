/**
 * The zip writer behind Campaign Export (core/campaignExport.ts): yazl, pure JavaScript, no
 * native build (ADR-0005). Entries are streamed: a file entry is opened only when yazl reaches
 * it, so an Export of any size never sits in memory.
 * yazl API: https://github.com/thejoshwolfe/yazl/blob/3.3.1/README.md
 */
import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, type ReadStream } from 'node:fs';
import fsp from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ZipFile } from 'yazl';
import type { WriteArchive } from '../core/campaignExport.js';

/**
 * A WriteArchive writing a zip to `target`. The zip is written next to it under a temporary
 * name and renamed over `target` once complete: a failed or cancelled write leaves no file.
 */
export function writeZipArchive(target: string): WriteArchive {
  return async (entries, { signal, onBytes } = {}) => {
    signal?.throwIfAborted();
    // A failed input (a file gone meanwhile) or a yazl 'error' event ends the write.
    const failed = new AbortController();
    const zip = new ZipFile();
    zip.on('error', (error: unknown) => failed.abort(error));
    const inputs = new Set<ReadStream>();

    for (const entry of entries) {
      const { source } = entry;
      if ('data' in source) {
        zip.addBuffer(Buffer.from(source.data), entry.path, { compress: entry.compress });
        onBytes?.(source.data.byteLength);
        continue;
      }
      // addReadStreamLazy, not addFile, to count the bytes read; `size` makes yazl check it.
      zip.addReadStreamLazy(
        entry.path,
        { compress: entry.compress, size: source.size },
        (callback) => {
          const input = createReadStream(source.file);
          inputs.add(input);
          input.on('close', () => inputs.delete(input));
          // Counted through a Transform: yazl pipes the stream, so no 'data' listener on it.
          const counted = new Transform({
            transform(chunk: Buffer, _encoding, done) {
              onBytes?.(chunk.byteLength);
              done(null, chunk);
            },
          });
          // yazl does not listen for errors of the streams it is given.
          input.on('error', (error) => failed.abort(error));
          callback(null, input.pipe(counted));
        },
      );
    }
    zip.end();

    const partial = `${target}.${randomUUID()}.partial`;
    try {
      await pipeline(zip.outputStream, createWriteStream(partial), {
        signal: signal ? AbortSignal.any([signal, failed.signal]) : failed.signal,
      });
      await fsp.rename(partial, target);
    } catch (error) {
      // Stop yazl: close the file it is reading, and ignore what it still writes.
      zip.outputStream.on('error', () => undefined);
      inputs.forEach((input) => input.destroy());
      await fsp.rm(partial, { force: true, maxRetries: 5 });
      throw failed.signal.aborted ? failed.signal.reason : error;
    }
  };
}
