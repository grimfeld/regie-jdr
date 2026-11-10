/**
 * The app's log: one small text file in the app's data folder, rotated so it stays bounded
 * (at most `maxFiles` files of about `maxFileBytes` each). No Electron dependency.
 *
 * Writes are synchronous on purpose: an entry logged just before a crash must reach the disk.
 * Logging never throws; if the disk refuses, the entry is lost, not the app.
 */
import fs from 'node:fs';
import path from 'node:path';

export type LogLevel = 'info' | 'warn' | 'error';

export interface Logger {
  info(message: string, detail?: unknown): void;
  warn(message: string, detail?: unknown): void;
  error(message: string, detail?: unknown): void;
  /** The current log file (the one the Game Master sends). */
  readonly filePath: string;
}

export interface FileLoggerOptions {
  /** Folder of the log files; created if missing. */
  directory: string;
  /** Size above which the current file is rotated. Default 256 KiB. */
  maxFileBytes?: number;
  /** Files kept, the current one included: regie.log, regie.1.log, … Default 3. */
  maxFiles?: number;
  /** Also called with every entry, e.g. to echo it to the console. */
  echo?: (level: LogLevel, entry: string) => void;
}

const BASE_NAME = 'regie';

export function createFileLogger(options: FileLoggerOptions): Logger {
  const { directory, maxFileBytes = 256 * 1024, maxFiles = 3, echo } = options;
  const fileAt = (index: number) =>
    path.join(directory, index === 0 ? `${BASE_NAME}.log` : `${BASE_NAME}.${index}.log`);
  const filePath = fileAt(0);

  function sizeOf(file: string): number {
    try {
      return fs.statSync(file).size;
    } catch {
      return 0;
    }
  }

  /** regie.log -> regie.1.log -> regie.2.log …; the oldest beyond maxFiles is dropped. */
  function rotate() {
    fs.rmSync(fileAt(maxFiles - 1), { force: true });
    for (let index = maxFiles - 2; index >= 0; index--) {
      if (fs.existsSync(fileAt(index))) fs.renameSync(fileAt(index), fileAt(index + 1));
    }
  }

  function write(level: LogLevel, message: string, detail: unknown) {
    let entry = `${new Date().toISOString()} ${level.toUpperCase()} ${message}`;
    if (detail !== undefined) entry += `\n  ${describe(detail).replace(/\n/g, '\n  ')}`;
    echo?.(level, entry);
    let line = `${entry}\n`;
    // An entry never exceeds a whole file, so the folder stays bounded whatever is logged.
    if (Buffer.byteLength(line) > maxFileBytes) {
      line = `${Buffer.from(line)
        .subarray(0, maxFileBytes - 16)
        .toString()} [tronqué]\n`;
    }
    try {
      fs.mkdirSync(directory, { recursive: true });
      if (sizeOf(filePath) + Buffer.byteLength(line) > maxFileBytes) rotate();
      fs.appendFileSync(filePath, line);
    } catch {
      // Nowhere left to report it: drop the entry rather than fail the caller.
    }
  }

  return {
    info: (message, detail) => write('info', message, detail),
    warn: (message, detail) => write('warn', message, detail),
    error: (message, detail) => write('error', message, detail),
    filePath,
  };
}

/** Readable text for anything thrown or rejected: the stack for errors, JSON otherwise. */
export function describe(value: unknown): string {
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
