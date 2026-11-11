/**
 * Partial files the app writes outside its data folder (an Export's zip, written as
 * `<target>.<uuid>.partial` and renamed once complete: electron/zipArchive.ts). A write that
 * fails or is cancelled removes its own; an app killed meanwhile cannot, so each one is recorded
 * in a small document of the data folder before it is created, and the next start deletes those
 * still there. No Electron dependency.
 *
 * The list is trusted no more than any file on disk: a recorded path is deleted only when it is
 * absolute, named like a partial file of the app and a plain file (not a folder or a link).
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createSerialQueue } from './serialQueue.js';
import type { DocumentStore, DocumentType } from './storage/index.js';

/** A partial file's name: what it will be, a random UUID, `.partial`. */
const PARTIAL_NAME = /\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.partial$/;
/** Most files recorded at once; a longer list is not one the app wrote. */
const MAX_FILES = 1000;

interface PartialFileList {
  files: string[];
}

const partialFilesDocument: DocumentType<PartialFileList> = {
  name: 'partial files',
  version: 1,
  migrations: {},
  parse({ files }) {
    if (!Array.isArray(files) || files.length > MAX_FILES) return undefined;
    return { files: files.filter((file): file is string => typeof file === 'string') };
  },
};

export interface PartialFiles {
  /** Records `file` before it is created. */
  add(file: string): Promise<void>;
  /** Forgets `file`, renamed into place or removed. */
  remove(file: string): Promise<void>;
  /** Deletes the recorded files still there (a killed app's), then forgets them all. */
  clear(): Promise<void>;
}

function isPartialFileName(file: string): boolean {
  return path.isAbsolute(file) && PARTIAL_NAME.test(path.basename(file));
}

/** Deletes `file` if it is a plain file; a folder, a link or nothing there is left alone. */
async function deleteIfFile(file: string): Promise<void> {
  const stats = await fsp.lstat(file).catch(() => undefined);
  if (stats?.isFile()) await fsp.rm(file, { force: true, maxRetries: 5 });
}

/** The partial files recorded in the document `listFile` of `documents`. */
export function createPartialFiles(documents: DocumentStore, listFile: string): PartialFiles {
  const serialized = createSerialQueue();
  const read = async () => (await documents.read(listFile, partialFilesDocument))?.files ?? [];
  const save = (files: string[]) => documents.write(listFile, partialFilesDocument, { files });

  return {
    add: (file) =>
      serialized(async () => {
        const files = await read();
        if (!files.includes(file)) await save([...files, file]);
      }),
    remove: (file) =>
      serialized(async () => {
        const files = await read();
        if (files.includes(file)) await save(files.filter((recorded) => recorded !== file));
      }),
    clear: () =>
      serialized(async () => {
        const files = await read();
        for (const file of files.filter(isPartialFileName)) await deleteIfFile(file);
        if (files.length > 0) await save([]);
      }),
  };
}
