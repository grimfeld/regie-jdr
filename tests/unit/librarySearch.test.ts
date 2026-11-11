import { describe, expect, it } from 'vitest';
import { imageLibrary, matchesSearch } from '../../core/librarySearch';
import type { AudioMedia, ImageCategory, ImageMedia } from '../../shared/domain';

function image(name: string, category: ImageCategory): ImageMedia {
  const base = { campaignId: 'c', contentHash: name, originalName: name, extension: '.png' };
  return { ...base, id: name, name, kind: 'image', category };
}

const sound: AudioMedia = {
  id: 'pluie',
  campaignId: 'c',
  contentHash: 'pluie',
  originalName: 'Château pluie',
  name: 'Château pluie',
  extension: '.ogg',
  kind: 'audio',
  role: 'ambience',
  durationSeconds: 92,
};

describe('library search', () => {
  it.each([
    ['Château hanté', 'chateau'],
    ['Château hanté', 'CHÂTEAU'],
    ['Forêt', 'foret'],
    ['foret', 'Forêt'],
    ['Cœur de la forêt', 'coeur'],
    ['Harbour at night', 'AT NI'],
    ['Orc', '  orc '],
    ['Orc', ''],
  ])('finds "%s" when searching "%s"', (name, query) => {
    expect(matchesSearch(name, query)).toBe(true);
  });

  it.each([
    ['Château hanté', 'chateaux'],
    ['Orc', 'gobelin'],
  ])('does not find "%s" when searching "%s"', (name, query) => {
    expect(matchesSearch(name, query)).toBe(false);
  });
});

describe('image library', () => {
  const castle = image('Château hanté', 'scenery');
  const orc = image('Orc', 'character');
  const forest = image('Forêt', 'scenery');
  const media = [castle, sound, orc, forest];

  it('shows every image, never audio, in library order', () => {
    expect(imageLibrary(media, 'all', '')).toEqual([castle, orc, forest]);
  });

  it('filters by Image category', () => {
    expect(imageLibrary(media, 'scenery', '')).toEqual([castle, forest]);
    expect(imageLibrary(media, 'character', '')).toEqual([orc]);
  });

  it('combines the filter with a search by name', () => {
    expect(imageLibrary(media, 'all', 'CHATEAU')).toEqual([castle]);
    expect(imageLibrary(media, 'character', 'chateau')).toEqual([]);
    expect(imageLibrary(media, 'scenery', 'FÔRET')).toEqual([forest]);
  });
});
