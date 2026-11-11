import { inflateRawSync } from 'node:zlib';

/** One entry of a zip, as its central directory describes it, with its content unpacked. */
export interface ZipEntry {
  name: string;
  /** 0: stored, 8: deflated. */
  method: number;
  content: Buffer;
}

/**
 * The entries of a small zip (no ZIP64, no encryption), read from its central directory: enough
 * for tests to check what an Export holds without an unzip library.
 */
export function readZipEntries(zip: Buffer): ZipEntry[] {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error('Not a zip: no end of central directory');
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const entries: ZipEntry[] = [];
  for (let index = 0; index < count; index++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error('Bad central directory header');
    const method = zip.readUInt16LE(at + 10);
    const compressedSize = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const localHeader = zip.readUInt32LE(at + 42);
    const name = zip.toString('utf8', at + 46, at + 46 + nameLength);
    const dataStart =
      localHeader + 30 + zip.readUInt16LE(localHeader + 26) + zip.readUInt16LE(localHeader + 28);
    const data = zip.subarray(dataStart, dataStart + compressedSize);
    entries.push({
      name,
      method,
      content: method === 8 ? inflateRawSync(data) : Buffer.from(data),
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
