/**
 * The Media protocol's answer for one file (electron/main.ts serves it): the whole file, or the
 * byte range a media element asks for to start quickly, seek and loop. The body streams from
 * disk as it is read, so neither a long Music nor an open-ended range (`bytes=N-`, asked at
 * each loop restart of a streamed sound) is ever held in memory whole. Short sounds are fetched
 * whole, without a range, and decoded (src/audioEngine.ts, src/padPlayer.ts).
 */
import fs from 'node:fs/promises';
import { parseByteRange } from './byteRange.js';

/**
 * Answers a request for `file` with its `Range` header (null for none): 200 with the whole file,
 * 206 with the range, or 416 for a range outside the file. `headers` (content type, CORS) go on
 * every answer. Throws when the file cannot be opened. If the file turns out shorter than its
 * size said (cut while being read), the body fails rather than send fewer bytes than announced.
 */
export async function mediaFileResponse(
  file: string,
  headers: Readonly<Record<string, string>>,
  rangeHeader: string | null,
): Promise<Response> {
  const handle = await fs.open(file, 'r');
  try {
    const { size } = await handle.stat();
    const base = { ...headers, 'accept-ranges': 'bytes' };
    const range = parseByteRange(rangeHeader, size);
    if (range === 'unsatisfiable') {
      await handle.close();
      return new Response(null, {
        status: 416,
        headers: { ...base, 'content-range': `bytes */${size}` },
      });
    }
    const { start, end } = range ?? { start: 0, end: size - 1 };
    const length = end - start + 1;
    if (length === 0) {
      await handle.close();
      return new Response(null, { headers: { ...base, 'content-length': '0' } });
    }
    const body = bodyOf(handle.createReadStream({ start, end, autoClose: true }), length);
    const sizeHeaders = { ...base, 'content-length': String(length) };
    return range
      ? new Response(body, {
          status: 206,
          headers: { ...sizeHeaders, 'content-range': `bytes ${start}-${end}/${size}` },
        })
      : new Response(body, { headers: sizeHeaders });
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

/**
 * The body of an answer: `chunks` read from disk one at a time as the receiver asks for them,
 * failing at the end if fewer than `length` bytes came, so no shortened file passes unnoticed.
 */
function bodyOf(chunks: AsyncIterable<Buffer>, length: number): ReadableStream<Uint8Array> {
  const iterator = chunks[Symbol.asyncIterator]();
  let passed = 0;
  return new ReadableStream({
    async pull(controller) {
      const next = await iterator.next();
      if (!next.done) {
        passed += next.value.length;
        controller.enqueue(next.value);
      } else if (passed < length) {
        controller.error(new Error(`Media file ended after ${passed} of ${length} bytes`));
      } else {
        controller.close();
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}
