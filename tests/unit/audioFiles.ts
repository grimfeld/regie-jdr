/**
 * Minimal audio files of a known duration, one per Media audio type, built byte by byte: just
 * the headers core/audioDuration.ts reads, followed by silence.
 */

function ascii(text: string): Buffer {
  return Buffer.from(text, 'latin1');
}

function u32be(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
}

/** PCM WAV, 8-bit mono, at `sampleRate` (1 byte per sample). */
export function wavFile(seconds: number, sampleRate = 1000): Buffer {
  const data = Buffer.alloc(Math.round(seconds * sampleRate), 0x80);
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0); // PCM
  fmt.writeUInt16LE(1, 2); // mono
  fmt.writeUInt32LE(sampleRate, 4);
  fmt.writeUInt32LE(sampleRate, 8); // bytes per second
  fmt.writeUInt16LE(1, 12); // block align
  fmt.writeUInt16LE(8, 14); // bits per sample
  const list = Buffer.concat([ascii('LIST'), Buffer.from([4, 0, 0, 0]), ascii('INFO')]);
  const chunks = Buffer.concat([
    ascii('fmt '),
    Buffer.from([16, 0, 0, 0]),
    fmt,
    list,
    ascii('data'),
    Buffer.alloc(4),
    data,
  ]);
  chunks.writeUInt32LE(data.length, chunks.length - data.length - 4);
  const header = Buffer.concat([ascii('RIFF'), Buffer.alloc(4), ascii('WAVE')]);
  header.writeUInt32LE(4 + chunks.length, 4);
  return Buffer.concat([header, chunks]);
}

/** FLAC with only its STREAMINFO block. */
export function flacFile(seconds: number, sampleRate = 44100): Buffer {
  const info = Buffer.alloc(34);
  const totalSamples = Math.round(seconds * sampleRate);
  info[10] = (sampleRate >> 12) & 0xff;
  info[11] = (sampleRate >> 4) & 0xff;
  // Sample rate (low 4 bits), 2 channels (1, 3 bits), 16 bits per sample (15, 5 bits).
  info[12] = ((sampleRate & 0x0f) << 4) | (1 << 1) | 0;
  info[13] = (15 << 4) | Math.floor(totalSamples / 2 ** 32);
  info.writeUInt32BE(totalSamples % 2 ** 32, 14);
  const blockHeader = Buffer.from([0x80, 0, 0, 34]); // last block, STREAMINFO, 34 bytes
  return Buffer.concat([ascii('fLaC'), blockHeader, info, Buffer.alloc(64)]);
}

/** One OGG page carrying `packet`, with a granule position (-1 for none). */
function oggPage(packet: Buffer, granule: bigint): Buffer {
  const header = Buffer.alloc(27);
  ascii('OggS').copy(header, 0);
  header.writeBigInt64LE(granule, 6);
  header[26] = 1; // one segment
  return Buffer.concat([header, Buffer.from([packet.length]), packet]);
}

/** OGG Vorbis: an identification header page, filler, and a last page at `seconds`. */
export function oggVorbisFile(seconds: number, sampleRate = 44100): Buffer {
  const identification = Buffer.alloc(30);
  identification[0] = 1;
  ascii('vorbis').copy(identification, 1);
  identification.writeUInt32LE(sampleRate, 12);
  return Buffer.concat([
    oggPage(identification, 0n),
    oggPage(Buffer.alloc(200), -1n),
    oggPage(Buffer.alloc(100), BigInt(Math.round(seconds * sampleRate))),
    // A trailing page where no packet ends: its granule says nothing.
    oggPage(Buffer.alloc(50), -1n),
  ]);
}

/** OGG Opus (always 48 kHz), with a pre-skip the duration leaves out. */
export function oggOpusFile(seconds: number, preSkip = 312): Buffer {
  const head = Buffer.alloc(19);
  ascii('OpusHead').copy(head, 0);
  head[8] = 1;
  head[9] = 2;
  head.writeUInt16LE(preSkip, 10);
  head.writeUInt32LE(44100, 12); // original rate: informative only
  return Buffer.concat([
    oggPage(head, 0n),
    oggPage(Buffer.alloc(100), BigInt(Math.round(seconds * 48000) + preSkip)),
  ]);
}

function box(type: string, ...content: Buffer[]): Buffer {
  const body = Buffer.concat(content);
  return Buffer.concat([u32be(8 + body.length), ascii(type), body]);
}

/** M4A: `ftyp`, a large `mdat` first, then `moov` with a version 0 `mvhd`. */
export function m4aFile(seconds: number, timescale = 1000): Buffer {
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(timescale, 12);
  mvhd.writeUInt32BE(Math.round(seconds * timescale), 16);
  return Buffer.concat([
    box('ftyp', ascii('M4A '), Buffer.alloc(4)),
    box('mdat', Buffer.alloc(5000)),
    box('moov', box('udta', Buffer.alloc(10)), box('mvhd', mvhd)),
  ]);
}

/** An ID3v2 tag of `length` bytes of content. */
function id3v2(length: number): Buffer {
  const header = Buffer.concat([ascii('ID3'), Buffer.from([3, 0, 0])]);
  const size = Buffer.from([
    (length >> 21) & 0x7f,
    (length >> 14) & 0x7f,
    (length >> 7) & 0x7f,
    length & 0x7f,
  ]);
  return Buffer.concat([header, size, Buffer.alloc(length)]);
}

/** MPEG 1 Layer III frame header: 128 kbit/s, 44.1 kHz, stereo. */
const MP3_FRAME_HEADER = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
/** Bytes in one such frame: 144 × 128000 / 44100. */
const MP3_FRAME_LENGTH = 417;

/** Constant bitrate MP3 (128 kbit/s) after an ID3v2 tag, with an ID3v1 tag at the end. */
export function mp3CbrFile(seconds: number): Buffer {
  const audio = Buffer.alloc(Math.round((seconds * 128000) / 8));
  MP3_FRAME_HEADER.copy(audio, 0);
  const id3v1 = Buffer.concat([ascii('TAG'), Buffer.alloc(125)]);
  return Buffer.concat([id3v2(300), audio, id3v1]);
}

/** Variable bitrate MP3: the first frame carries a Xing header with the frame count. */
export function mp3XingFile(frames: number): Buffer {
  const first = Buffer.alloc(MP3_FRAME_LENGTH);
  MP3_FRAME_HEADER.copy(first, 0);
  const xing = 4 + 32; // after the side information of an MPEG 1 stereo frame
  ascii('Xing').copy(first, xing);
  first.writeUInt32BE(1, xing + 4); // frames field present
  first.writeUInt32BE(frames, xing + 8);
  return Buffer.concat([first, Buffer.alloc(MP3_FRAME_LENGTH * 3)]);
}
