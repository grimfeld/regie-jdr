import { crc32, deflateRawSync } from 'node:zlib';

/** One entry of a hand-made zip; every field a zip writer would check can be set wrong. */
export interface RawZipEntry {
  /** Stored as is: may hold `..`, backslashes, a drive letter. */
  name: string;
  content?: Buffer | string;
  /** Deflated when true (a zip bomb compresses well); stored otherwise. */
  deflate?: boolean;
  /** Uncompressed size written in the headers, instead of the real one. */
  declaredSize?: number;
  /** Unix file type and mode (e.g. 0o120777 for a link), written as made on Unix. */
  unixMode?: number;
  /** Sets the "encrypted" flag. */
  encrypted?: boolean;
}

/**
 * A zip built byte by byte, for tests feeding hostile archives to the Import: a zip library
 * refuses to write most of them. No ZIP64, no data descriptors.
 */
export function rawZip(entries: readonly RawZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const content = Buffer.from(entry.content ?? '');
    const data = entry.deflate ? deflateRawSync(content) : content;
    const method = entry.deflate ? 8 : 0;
    const size = entry.declaredSize ?? content.byteLength;
    const flags = 0x800 | (entry.encrypted ? 1 : 0);
    const crc = crc32(content);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.byteLength, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.byteLength, 26);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(entry.unixMode === undefined ? 20 : (3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.byteLength, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.byteLength, 28);
    central.writeUInt32LE(((entry.unixMode ?? 0) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.byteLength + name.byteLength + data.byteLength;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.byteLength, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
