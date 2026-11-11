/**
 * HTTP byte ranges for the Media protocol: the audio engine streams Music and Ambiences through
 * media elements, which ask for parts of a file to start quickly, seek and loop. No Node or
 * Electron dependency.
 */

/** The bytes to send, both ends included. */
export interface ByteRange {
  start: number;
  end: number;
}

/**
 * The part of a `size`-byte file a `Range` header asks for: undefined for the whole file (no
 * header, or one this server does not handle, such as several ranges), 'unsatisfiable' for a
 * range outside the file. Handles `bytes=a-b`, `bytes=a-` and `bytes=-n` (the last n bytes).
 */
export function parseByteRange(
  header: string | null,
  size: number,
): ByteRange | 'unsatisfiable' | undefined {
  if (header === null) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return undefined;
  const [, first, last] = match;
  if (first === '' && last === '') return undefined;
  if (first === '') {
    const length = Number(last);
    if (length === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - length), end: size - 1 };
  }
  const start = Number(first);
  const end = last === '' ? size - 1 : Math.min(Number(last), size - 1);
  if (start >= size || end < start) return 'unsatisfiable';
  return { start, end };
}
