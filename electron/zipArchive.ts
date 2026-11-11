/**
 * The zip writer behind Campaign Export (core/campaignExport.ts) and the zip reader behind
 * Campaign Import (core/campaignImport.ts): yazl and yauzl, pure JavaScript, no native build
 * (ADR-0005). Entries are streamed both ways, so a Campaign of any size never sits in memory.
 * yazl API: https://github.com/thejoshwolfe/yazl/blob/3.3.1/README.md
 * yauzl API: https://github.com/thejoshwolfe/yauzl/blob/3.4.0/README.md
 */
import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, type ReadStream } from 'node:fs';
import fsp from 'node:fs/promises';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as yauzl from 'yauzl';
import { ZipFile } from 'yazl';
import type { WriteArchive } from '../core/campaignExport.js';
import { unreadableArchive, type ArchiveFile, type OpenArchive } from '../core/campaignImport.js';

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

/** Unix file types, from the high 16 bits of a zip entry's external attributes. */
const UNIX_TYPE_MASK = 0o170000;
const UNIX_FILE = 0o100000;
const UNIX_FOLDER = 0o040000;
const UNIX_LINK = 0o120000;
const DOS_FOLDER = 0x10;

/** What a zip entry is. Anything but a plain, readable file or folder is `link` or `other`. */
export function archiveFileKind(entry: yauzl.Entry): ArchiveFile['kind'] {
  const attributes = entry.externalFileAttributes;
  const unixType = (attributes >>> 16) & UNIX_TYPE_MASK;
  if (unixType === UNIX_LINK) return 'link';
  if (entry.isEncrypted() || !entry.canDecodeFileData()) return 'other';
  if (entry.fileName.endsWith('/') || unixType === UNIX_FOLDER || attributes & DOS_FOLDER) {
    return 'folder';
  }
  return unixType === 0 || unixType === UNIX_FILE ? 'file' : 'other';
}

/** Content of an entry; a read failure (bad data, wrong size) is an unreadable archive. */
async function* readable(stream: Readable): AsyncGenerator<Uint8Array> {
  try {
    for await (const chunk of stream) yield chunk as Buffer;
  } catch (error) {
    throw unreadableArchive(error);
  } finally {
    stream.destroy();
  }
}

/**
 * An OpenArchive reading the zip `file` with yauzl. yauzl already refuses absolute paths, `..`
 * and backslashes in entry names (strictFileNames) and content whose size differs from what the
 * zip declares (validateEntrySizes); core/campaignImport.ts checks every name again, more
 * strictly. Every yauzl failure becomes an ImportError, so no English message reaches a window.
 */
export function openZipArchive(file: string): OpenArchive {
  return async () => {
    let zip: yauzl.ZipFile;
    let archiveBytes: number;
    try {
      archiveBytes = (await fsp.stat(file)).size;
      zip = await yauzl.openPromise(file, {
        autoClose: false,
        decodeStrings: true,
        strictFileNames: true,
        validateEntrySizes: true,
      });
    } catch (error) {
      throw unreadableArchive(error);
    }
    return {
      archiveBytes,
      entryCount: zip.entryCount,
      async *entries() {
        const entries = zip.eachEntry();
        for (;;) {
          let next: IteratorResult<yauzl.Entry>;
          try {
            next = await entries.next();
          } catch (error) {
            throw unreadableArchive(error);
          }
          if (next.done) return;
          const entry = next.value;
          yield {
            path: entry.fileName,
            kind: archiveFileKind(entry),
            declaredSize: entry.uncompressedSize,
            async open() {
              try {
                return readable(await zip.openReadStreamPromise(entry));
              } catch (error) {
                throw unreadableArchive(error);
              }
            },
          };
        }
      },
      close() {
        zip.close();
      },
    };
  };
}
