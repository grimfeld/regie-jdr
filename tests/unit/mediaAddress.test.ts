import { describe, expect, it } from 'vitest';
import { mediaKindOfFileName } from '../../core/mediaAddress';

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
