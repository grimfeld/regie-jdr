import * as yauzl from 'yauzl';

/** One entry of a zip, with its content unpacked. */
export interface ZipEntry {
  name: string;
  /** 0: stored, 8: deflated. */
  method: number;
  content: Buffer;
}

/** The entries of a zip, in order, read with yauzl: for tests checking what an Export holds. */
export async function readZipEntries(zip: Buffer): Promise<ZipEntry[]> {
  const file = await yauzl.fromBufferPromise(zip);
  const entries: ZipEntry[] = [];
  for await (const entry of file.eachEntry()) {
    const chunks: Buffer[] = [];
    for await (const chunk of await file.openReadStreamPromise(entry)) chunks.push(chunk as Buffer);
    entries.push({
      name: entry.fileName,
      method: entry.compressionMethod,
      content: Buffer.concat(chunks),
    });
  }
  return entries;
}
