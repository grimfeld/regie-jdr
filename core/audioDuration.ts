/**
 * Reads the duration of an audio file from its headers, without decoding it, for every audio
 * type a Media can have (MP3, WAV, OGG, FLAC, M4A). No Electron dependency: the main process has
 * no media decoder, and the library records the duration at import (core/media.ts).
 *
 * Only the few bytes the format needs are read (the head, the tail for OGG, the box headers for
 * M4A), so a long file costs no more than a short one. A file this cannot read (damaged, or a
 * variant it does not know) has no duration: `undefined`, never an error.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';

/** Reads `length` bytes at `position` (fewer at the end of the file). */
type ReadAt = (position: number, length: number) => Promise<Buffer>;

interface AudioFile {
  size: number;
  readAt: ReadAt;
}

/** Bytes read from the start of the file to find the first MP3 frame or the OGG headers. */
const HEAD_LENGTH = 64 * 1024;
/** Bytes read from the end of an OGG file: more than its largest possible page. */
const OGG_TAIL_LENGTH = 66 * 1024;

/** The duration in seconds of an audio file, or undefined when it cannot be read. */
export async function readAudioDuration(file: string): Promise<number | undefined> {
  const reader = DURATION_READERS[path.extname(file).toLowerCase()];
  if (!reader) return undefined;
  let handle: fsp.FileHandle | undefined;
  try {
    handle = await fsp.open(file, 'r');
    const opened = handle;
    const { size } = await opened.stat();
    const readAt: ReadAt = async (position, length) => {
      const buffer = Buffer.alloc(Math.max(0, Math.min(length, size - position)));
      const { bytesRead } = await opened.read(buffer, 0, buffer.length, position);
      return buffer.subarray(0, bytesRead);
    };
    const seconds = await reader({ size, readAt });
    return seconds !== undefined && Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
  } catch {
    return undefined;
  } finally {
    await handle?.close();
  }
}

const DURATION_READERS: Partial<Record<string, (file: AudioFile) => Promise<number | undefined>>> =
  {
    '.wav': wavDuration,
    '.flac': flacDuration,
    '.ogg': oggDuration,
    '.m4a': m4aDuration,
    '.mp3': mp3Duration,
  };

function fourCC(buffer: Buffer, offset: number): string {
  return buffer.toString('latin1', offset, offset + 4);
}

// WAV ----------------------------------------------------------------------

/** RIFF chunks: `fmt ` gives the bytes per second, `data` the length of the sound. */
async function wavDuration({ size, readAt }: AudioFile): Promise<number | undefined> {
  const header = await readAt(0, 12);
  if (header.length < 12 || fourCC(header, 0) !== 'RIFF' || fourCC(header, 8) !== 'WAVE') {
    return undefined;
  }
  let byteRate: number | undefined;
  let position = 12;
  while (position + 8 <= size) {
    const chunk = await readAt(position, 20);
    if (chunk.length < 8) return undefined;
    const id = fourCC(chunk, 0);
    const length = chunk.readUInt32LE(4);
    // fmt: format (2 bytes), channels (2), sample rate (4), then bytes per second (4).
    if (id === 'fmt ' && chunk.length >= 20) byteRate = chunk.readUInt32LE(8 + 8);
    if (id === 'data') {
      if (!byteRate) return undefined;
      // A stream that was never finished says 0 or 0xFFFFFFFF: the rest of the file is sound.
      const available = size - position - 8;
      const dataLength = length === 0 || length > available ? available : length;
      return dataLength / byteRate;
    }
    position += 8 + length + (length % 2);
  }
  return undefined;
}

// FLAC ---------------------------------------------------------------------

/** The STREAMINFO block, always first, gives the sample rate and the total samples. */
async function flacDuration({ readAt }: AudioFile): Promise<number | undefined> {
  const start = id3v2Length(await readAt(0, 10));
  const head = await readAt(start, 4 + 4 + 34);
  if (head.length < 42 || fourCC(head, 0) !== 'fLaC' || (head[4] & 0x7f) !== 0) return undefined;
  const info = head.subarray(8);
  const sampleRate = (info[10] << 12) | (info[11] << 4) | (info[12] >> 4);
  const totalSamples = (info[13] & 0x0f) * 2 ** 32 + info.readUInt32BE(14);
  if (sampleRate === 0 || totalSamples === 0) return undefined;
  return totalSamples / sampleRate;
}

// OGG ----------------------------------------------------------------------

/**
 * The first page names the codec and its sample rate (Vorbis) or pre-skip (Opus, always
 * 48 kHz); the last page's granule position is the number of samples.
 */
async function oggDuration({ size, readAt }: AudioFile): Promise<number | undefined> {
  const head = await readAt(0, HEAD_LENGTH);
  if (head.length < 28 || fourCC(head, 0) !== 'OggS') return undefined;
  const packet = head.subarray(27 + head[26]);
  let sampleRate: number;
  let preSkip = 0;
  if (packet.length >= 16 && packet[0] === 1 && packet.toString('latin1', 1, 7) === 'vorbis') {
    sampleRate = packet.readUInt32LE(12);
  } else if (packet.length >= 12 && packet.toString('latin1', 0, 8) === 'OpusHead') {
    sampleRate = 48000;
    preSkip = packet.readUInt16LE(10);
  } else {
    return undefined;
  }
  if (sampleRate === 0) return undefined;
  const tailStart = Math.max(0, size - OGG_TAIL_LENGTH);
  const tail = await readAt(tailStart, OGG_TAIL_LENGTH);
  let at = tail.lastIndexOf('OggS');
  while (at >= 0) {
    const granule = at + 14 <= tail.length ? Number(tail.readBigInt64LE(at + 6)) : -1;
    // -1 marks a page where no packet ends; look further back.
    if (granule > 0) return Math.max(0, granule - preSkip) / sampleRate;
    at = at === 0 ? -1 : tail.lastIndexOf('OggS', at - 1);
  }
  return undefined;
}

// M4A ----------------------------------------------------------------------

/** The movie header (`moov` > `mvhd`) gives a time scale and a duration in its units. */
async function m4aDuration({ size, readAt }: AudioFile): Promise<number | undefined> {
  const moov = await findBox(readAt, 0, size, 'moov');
  if (!moov) return undefined;
  const mvhd = await findBox(readAt, moov.start, moov.end, 'mvhd');
  if (!mvhd) return undefined;
  const body = await readAt(mvhd.start, 32);
  if (body.length < 1) return undefined;
  const version = body[0];
  if (version === 0 && body.length >= 20) {
    const timescale = body.readUInt32BE(12);
    return timescale ? body.readUInt32BE(16) / timescale : undefined;
  }
  if (version === 1 && body.length >= 32) {
    const timescale = body.readUInt32BE(20);
    return timescale ? Number(body.readBigUInt64BE(24)) / timescale : undefined;
  }
  return undefined;
}

/** The content of the first box of `type` between `start` and `end`, or undefined. */
async function findBox(
  readAt: ReadAt,
  start: number,
  end: number,
  type: string,
): Promise<{ start: number; end: number } | undefined> {
  let position = start;
  while (position + 8 <= end) {
    const header = await readAt(position, 16);
    if (header.length < 8) return undefined;
    let length = header.readUInt32BE(0);
    let headerLength = 8;
    if (length === 1) {
      if (header.length < 16) return undefined;
      length = Number(header.readBigUInt64BE(8));
      headerLength = 16;
    } else if (length === 0) {
      length = end - position;
    }
    if (length < headerLength) return undefined;
    if (fourCC(header, 4) === type) {
      return { start: position + headerLength, end: Math.min(end, position + length) };
    }
    position += length;
  }
  return undefined;
}

// MP3 ----------------------------------------------------------------------

/** Kilobits per second by bitrate index, per MPEG version 1 / 2 and layer I / II / III. */
const BITRATES = {
  v1: [
    [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
    [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
    [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  ],
  v2: [
    [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
    [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
    [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  ],
};
const MPEG1_SAMPLE_RATES = [44100, 48000, 32000];

interface Mp3Frame {
  /** 1 for MPEG 1, 2 for MPEG 2 and 2.5. */
  version: 1 | 2;
  sampleRate: number;
  bitrate: number;
  samplesPerFrame: number;
  mono: boolean;
}

/** The MPEG audio frame header at `at`, or undefined if there is none. */
function mp3Frame(buffer: Buffer, at: number): Mp3Frame | undefined {
  if (at + 4 > buffer.length || buffer[at] !== 0xff || (buffer[at + 1] & 0xe0) !== 0xe0) {
    return undefined;
  }
  const versionBits = (buffer[at + 1] >> 3) & 3; // 0: 2.5, 2: 2, 3: 1
  const layerBits = (buffer[at + 1] >> 1) & 3; // 1: III, 2: II, 3: I
  const bitrateIndex = buffer[at + 2] >> 4;
  const rateIndex = (buffer[at + 2] >> 2) & 3;
  if (versionBits === 1 || layerBits === 0 || bitrateIndex === 0 || bitrateIndex === 15) {
    return undefined;
  }
  if (rateIndex === 3) return undefined;
  const version = versionBits === 3 ? 1 : 2;
  const layer = 4 - layerBits; // 1, 2 or 3
  const divisor = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 4;
  const sampleRate = MPEG1_SAMPLE_RATES[rateIndex] / divisor;
  const bitrate = BITRATES[version === 1 ? 'v1' : 'v2'][layer - 1][bitrateIndex] * 1000;
  const samplesPerFrame = layer === 1 ? 384 : layer === 3 && version === 2 ? 576 : 1152;
  const mono = buffer[at + 3] >> 6 === 3;
  return { version, sampleRate, bitrate, samplesPerFrame, mono };
}

/**
 * A variable bitrate file says its frame count in a Xing / Info or VBRI header in the first
 * frame; otherwise the bitrate is constant and the size of the sound gives the duration.
 */
async function mp3Duration({ size, readAt }: AudioFile): Promise<number | undefined> {
  const audioStart = id3v2Length(await readAt(0, 10));
  const head = await readAt(audioStart, HEAD_LENGTH);
  let at = 0;
  let frame: Mp3Frame | undefined;
  for (; at + 4 <= head.length; at++) {
    frame = mp3Frame(head, at);
    if (frame) break;
  }
  if (!frame) return undefined;
  const sideInfo = frame.version === 1 ? (frame.mono ? 17 : 32) : frame.mono ? 9 : 17;
  const xing = at + 4 + sideInfo;
  const xingId = head.toString('latin1', xing, xing + 4);
  if ((xingId === 'Xing' || xingId === 'Info') && xing + 12 <= head.length) {
    const hasFrames = (head.readUInt32BE(xing + 4) & 1) === 1;
    if (hasFrames) return (head.readUInt32BE(xing + 8) * frame.samplesPerFrame) / frame.sampleRate;
  }
  const vbri = at + 4 + 32;
  if (head.toString('latin1', vbri, vbri + 4) === 'VBRI' && vbri + 18 <= head.length) {
    return (head.readUInt32BE(vbri + 14) * frame.samplesPerFrame) / frame.sampleRate;
  }
  const id3v1 = size >= 128 && (await readAt(size - 128, 3)).toString('latin1') === 'TAG';
  const soundLength = size - audioStart - at - (id3v1 ? 128 : 0);
  return (soundLength * 8) / frame.bitrate;
}

/** Length of an ID3v2 tag at the start of a file (0 when there is none). */
function id3v2Length(header: Buffer): number {
  if (header.length < 10 || header.toString('latin1', 0, 3) !== 'ID3') return 0;
  const length = (header[6] << 21) | (header[7] << 14) | (header[8] << 7) | header[9];
  const footer = (header[5] & 0x10) !== 0 ? 10 : 0;
  return 10 + length + footer;
}
