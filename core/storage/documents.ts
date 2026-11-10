/**
 * Versioned JSON documents on disk (ADR-0001), with no Electron dependency.
 *
 * - Every document is a JSON object carrying `schemaVersion` next to its own fields.
 * - Writes go to `<file>.tmp`, then rename over `<file>`: an interrupted write never leaves a
 *   half-written document. The previous good version is kept as `<file>.bak`.
 * - On load, older documents pass through the type's migrations, one version at a time.
 * - A corrupt document (unreadable JSON or not matching its type) is recovered from the backup,
 *   put back in place, and reported through `onRecovered`.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { isRecord } from '../guards.js';
import { createKeyedSerialQueue } from '../serialQueue.js';

type Fields = Record<string, unknown>;

/** How one kind of document is stored: its current schema version, migrations and check. */
export interface DocumentType<T> {
  /** Short name, used in errors and recovery reports (e.g. "campaign"). */
  name: string;
  /** Current schema version, written into every saved document. Starts at 1. */
  version: number;
  /** `migrations[n]` upgrades the fields of a version-n document to version n + 1. */
  migrations: Record<number, (fields: Fields) => Fields>;
  /** Checks fields at the current version (without `schemaVersion`); undefined if invalid. */
  parse(fields: Fields): T | undefined;
}

/** A corrupt document that was replaced by its backup. */
export interface Recovery {
  file: string;
  documentType: string;
}

/** The file operations the store needs; replaceable in tests to simulate failures. */
export interface FileSystem {
  /** Reads a UTF-8 file; undefined if it does not exist. */
  readFile(file: string): Promise<string | undefined>;
  /** Writes and flushes a UTF-8 file, creating it or truncating it. */
  writeFile(file: string, data: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(file: string): Promise<void>;
  makeDirectory(directory: string): Promise<void>;
}

export interface DocumentStore {
  /** The document, migrated to the current version; undefined if it was never written. */
  read<T>(file: string, type: DocumentType<T>): Promise<T | undefined>;
  write<T>(file: string, type: DocumentType<T>, value: T): Promise<void>;
  /** Removes the document and its backup. */
  remove(file: string): Promise<void>;
}

export class DocumentError extends Error {}

export const nodeFileSystem: FileSystem = {
  async readFile(file) {
    try {
      return await fsp.readFile(file, 'utf8');
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  },
  async writeFile(file, data) {
    const handle = await fsp.open(file, 'w');
    try {
      await handle.writeFile(data, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
  async rename(from, to) {
    // Windows can briefly lock a file (antivirus, indexer): retry a few times.
    for (let attempt = 0; ; attempt++) {
      try {
        return await fsp.rename(from, to);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (attempt >= 5 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES'))
          throw error;
        await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
      }
    }
  },
  async remove(file) {
    await fsp.rm(file, { force: true });
  },
  async makeDirectory(directory) {
    await fsp.mkdir(directory, { recursive: true });
  },
};

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

type Decoded<T> =
  { status: 'ok'; value: T } | { status: 'corrupt' } | { status: 'tooNew'; version: number };

/** Parses, migrates and checks the text of a document. */
function decode<T>(text: string, type: DocumentType<T>): Decoded<T> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { status: 'corrupt' };
  }
  if (!isRecord(raw)) return { status: 'corrupt' };
  const { schemaVersion, ...rest } = raw;
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion) || schemaVersion < 1) {
    return { status: 'corrupt' };
  }
  if (schemaVersion > type.version) return { status: 'tooNew', version: schemaVersion };
  let fields: Fields = rest;
  for (let version = schemaVersion; version < type.version; version++) {
    const migrate = type.migrations[version];
    if (!migrate) {
      throw new DocumentError(`No migration for ${type.name} documents from version ${version}`);
    }
    fields = migrate(fields);
  }
  const value = type.parse(fields);
  return value === undefined ? { status: 'corrupt' } : { status: 'ok', value };
}

function encode<T>(type: DocumentType<T>, value: T): string {
  return `${JSON.stringify({ schemaVersion: type.version, ...value }, null, 2)}\n`;
}

/** True when the text is a document worth keeping as a backup. */
function looksValid(text: string): boolean {
  try {
    const raw: unknown = JSON.parse(text);
    return isRecord(raw) && typeof raw.schemaVersion === 'number';
  } catch {
    return false;
  }
}

export function createDocumentStore(
  options: { fileSystem?: FileSystem; onRecovered?: (recovery: Recovery) => void } = {},
): DocumentStore {
  const fileSystem = options.fileSystem ?? nodeFileSystem;
  // One operation at a time per file, so concurrent writes never share a temp file.
  const queue = createKeyedSerialQueue<string>();
  const serialized = <R>(file: string, operation: () => Promise<R>) =>
    queue(path.resolve(file), operation);

  /** Writes `text` to `target` through a temporary file and a rename. */
  async function replaceAtomically(target: string, text: string): Promise<void> {
    const temporary = `${target}.tmp`;
    await fileSystem.writeFile(temporary, text);
    await fileSystem.rename(temporary, target);
  }

  async function write<T>(file: string, type: DocumentType<T>, value: T): Promise<void> {
    const text = encode(type, value);
    await fileSystem.makeDirectory(path.dirname(file));
    const current = await fileSystem.readFile(file);
    if (current !== undefined && looksValid(current)) {
      await replaceAtomically(`${file}.bak`, current);
    }
    await replaceAtomically(file, text);
  }

  async function read<T>(file: string, type: DocumentType<T>): Promise<T | undefined> {
    const text = await fileSystem.readFile(file);
    if (text === undefined) return undefined;
    const decoded = decode(text, type);
    if (decoded.status === 'ok') return decoded.value;
    if (decoded.status === 'tooNew') {
      throw new DocumentError(
        `${file}: this ${type.name} was saved by a newer version of the app ` +
          `(schema ${decoded.version}, this app reads up to ${type.version})`,
      );
    }
    const backup = await fileSystem.readFile(`${file}.bak`);
    const fromBackup = backup === undefined ? undefined : decode(backup, type);
    if (backup === undefined || fromBackup?.status !== 'ok') {
      throw new DocumentError(`${file}: this ${type.name} is corrupt and has no usable backup`);
    }
    await replaceAtomically(file, backup);
    options.onRecovered?.({ file, documentType: type.name });
    return fromBackup.value;
  }

  return {
    read: (file, type) => serialized(file, () => read(file, type)),
    write: (file, type, value) => serialized(file, () => write(file, type, value)),
    remove: (file) =>
      serialized(file, async () => {
        await fileSystem.remove(file);
        await fileSystem.remove(`${file}.bak`);
      }),
  };
}
