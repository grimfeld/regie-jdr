import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readAudioDuration } from '../../core/audioDuration';
import {
  flacFile,
  m4aFile,
  mp3CbrFile,
  mp3XingFile,
  oggOpusFile,
  oggVorbisFile,
  wavFile,
} from './audioFiles';
import { useTempDir } from './tempDir';

describe('audio duration', () => {
  const dir = useTempDir();

  async function durationOf(name: string, content: Buffer | string) {
    const file = path.join(dir.path, name);
    await fs.writeFile(file, content);
    return readAudioDuration(file);
  }

  it('reads a WAV file’s duration from its data and format chunks', async () => {
    expect(await durationOf('pluie.wav', wavFile(2.5))).toBeCloseTo(2.5, 3);
  });

  it('reads a FLAC file’s duration from its stream information', async () => {
    expect(await durationOf('feu.flac', flacFile(185.25))).toBeCloseTo(185.25, 3);
  });

  it('reads an OGG Vorbis or Opus file’s duration from its last page', async () => {
    expect(await durationOf('vent.ogg', oggVorbisFile(61.5))).toBeCloseTo(61.5, 3);
    expect(await durationOf('voix.ogg', oggOpusFile(12))).toBeCloseTo(12, 3);
  });

  it('reads an M4A file’s duration from its movie header, wherever it sits', async () => {
    expect(await durationOf('taverne.m4a', m4aFile(240.5))).toBeCloseTo(240.5, 3);
  });

  it('reads an MP3 file’s duration from its Xing header, or from its size at a constant bitrate', async () => {
    // 1152 samples per frame at 44.1 kHz.
    expect(await durationOf('combat.mp3', mp3XingFile(3000))).toBeCloseTo((3000 * 1152) / 44100, 3);
    expect(await durationOf('cloche.mp3', mp3CbrFile(3))).toBeCloseTo(3, 3);
  });

  it('gives no duration for a file it cannot read, rather than failing', async () => {
    expect(await durationOf('faux.ogg', 'OggS')).toBeUndefined();
    expect(await durationOf('faux.mp3', 'pas un son')).toBeUndefined();
    expect(await durationOf('faux.wav', 'RIFF')).toBeUndefined();
    expect(await durationOf('vide.flac', '')).toBeUndefined();
    expect(await durationOf('faux.m4a', Buffer.alloc(40))).toBeUndefined();
    expect(await durationOf('image.png', wavFile(1))).toBeUndefined();
    expect(await readAudioDuration(path.join(dir.path, 'parti.wav'))).toBeUndefined();
  });
});
