import { describe, expect, it } from 'vitest';
import { imageExtensionOfContent, mediaKindOfFileName } from '../../core/mediaAddress';

describe('Media kind of a file name', () => {
  it.each([
    ['Cantina.png', 'image'],
    ['Orc.JPEG', 'image'],
    ['carte.v2.webp', 'image'],
    ['Taverne.mp3', 'audio'],
    ['Pluie.OGG', 'audio'],
    ['Épée.wav', 'audio'],
    ['feu.flac', 'audio'],
    ['voix.m4a', 'audio'],
  ])('%s is %s', (fileName, kind) => {
    expect(mediaKindOfFileName(fileName)).toBe(kind);
  });

  it.each(['notes.txt', 'sans-extension', 'archive.png.zip', '.mp3x', ''])(
    '%s is no Media',
    (fileName) => {
      expect(mediaKindOfFileName(fileName)).toBeUndefined();
    },
  );
});

const codes = (text: string) => Array.from(text, (c) => c.charCodeAt(0));

describe('image type of content', () => {
  it.each([
    ['PNG', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0], '.png'],
    ['JPEG', [0xff, 0xd8, 0xff, 0xdb], '.jpg'],
    ['WebP', [...codes('RIFF'), 1, 0, 0, 0, ...codes('WEBP')], '.webp'],
  ])('%s', (_type, bytes, extension) => {
    expect(imageExtensionOfContent(new Uint8Array(bytes))).toBe(extension);
  });

  it.each([
    ['nothing', []],
    ['text', codes('abc')],
    ['a truncated PNG signature', [0x89, 0x50, 0x4e, 0x47]],
    ['GIF', codes('GIF89a')],
    ['a RIFF that is not WebP', codes('RIFF....WAVE')],
  ])('%s is no image', (_name, bytes) => {
    expect(imageExtensionOfContent(new Uint8Array(bytes))).toBeUndefined();
  });
});
