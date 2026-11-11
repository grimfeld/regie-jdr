import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { mediaFileResponse } from '../../core/mediaResponse';
import { useTempDir } from './tempDir';

const headers = { 'content-type': 'audio/wav', 'access-control-allow-origin': '*' };

/** A file of `size` bytes, each its position modulo 251, so a part shows where it came from. */
async function fileOf(dir: string, size: number): Promise<{ file: string; content: Buffer }> {
  const content = Buffer.alloc(size);
  for (let i = 0; i < size; i += 1) content[i] = i % 251;
  const file = path.join(dir, 'son.wav');
  await fs.writeFile(file, content);
  return { file, content };
}

async function bodyOf(response: Response): Promise<Buffer> {
  return Buffer.from(await response.arrayBuffer());
}

describe('the Media protocol’s answer for a file', () => {
  const dir = useTempDir();

  it('serves the whole file without a Range header, 200 with its length', async () => {
    const { file, content } = await fileOf(dir.path, 100_000);

    const response = await mediaFileResponse(file, headers, null);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBe('100000');
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('content-type')).toBe('audio/wav');
    expect(await bodyOf(response)).toEqual(content);
  });

  it('serves an open-ended range (a loop restart) from its start to the end, 206', async () => {
    const { file, content } = await fileOf(dir.path, 100_000);

    const response = await mediaFileResponse(file, headers, 'bytes=40000-');

    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 40000-99999/100000');
    expect(response.headers.get('content-length')).toBe('60000');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(await bodyOf(response)).toEqual(content.subarray(40000));
  });

  it('serves a closed range and a suffix range', async () => {
    const { file, content } = await fileOf(dir.path, 1000);

    const middle = await mediaFileResponse(file, headers, 'bytes=10-19');
    expect(middle.status).toBe(206);
    expect(middle.headers.get('content-range')).toBe('bytes 10-19/1000');
    expect(await bodyOf(middle)).toEqual(content.subarray(10, 20));

    const last = await mediaFileResponse(file, headers, 'bytes=-5');
    expect(last.headers.get('content-range')).toBe('bytes 995-999/1000');
    expect(await bodyOf(last)).toEqual(content.subarray(995));
  });

  it('answers 416 to a range outside the file', async () => {
    const { file } = await fileOf(dir.path, 1000);

    const response = await mediaFileResponse(file, headers, 'bytes=1000-');

    expect(response.status).toBe(416);
    expect(response.headers.get('content-range')).toBe('bytes */1000');
  });

  it('serves an empty file', async () => {
    const { file } = await fileOf(dir.path, 0);

    const response = await mediaFileResponse(file, headers, null);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBe('0');
    expect(await bodyOf(response)).toEqual(Buffer.alloc(0));
  });

  it('reads the file as the body is read, failing it when the file ends short, never padding', async () => {
    const { file } = await fileOf(dir.path, 4_000_000);

    const response = await mediaFileResponse(file, headers, 'bytes=0-');
    // Shortened (rewritten, or cut by another program) once the answer is under way.
    await fs.truncate(file, 100_000);

    await expect(bodyOf(response)).rejects.toThrow();
  });

  it('throws for a file that is not there, for the caller to answer 404', async () => {
    await expect(
      mediaFileResponse(path.join(dir.path, 'absent.wav'), headers, null),
    ).rejects.toThrow();
  });
});
