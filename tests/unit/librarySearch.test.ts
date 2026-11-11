import { describe, expect, it } from 'vitest';
import {
  audioLibrary,
  formatDuration,
  imageLibrary,
  matchesSearch,
} from '../../core/librarySearch';
import type { AudioMedia, AudioRole, ImageCategory, ImageMedia } from '../../shared/domain';

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

function audio(name: string, role: AudioRole): AudioMedia {
  const base = { campaignId: 'c', contentHash: name, originalName: name, extension: '.mp3' };
  return { ...base, id: name, name, kind: 'audio', role, durationSeconds: 60 };
}

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

describe('audio library', () => {
  const tavern = audio('Taverne animée', 'music');
  const rain = audio('Pluie sur la forêt', 'ambience');
  const sword = audio('Épée', 'soundEffect');
  const battle = audio('Bataille', 'music');
  const media = [tavern, image('Forêt', 'scenery'), rain, sword, battle];

  it('shows every sound, never images, in library order', () => {
    expect(audioLibrary(media, 'all', '')).toEqual([tavern, rain, sword, battle]);
  });

  it('filters by role: Music, Ambience or Sound effect', () => {
    expect(audioLibrary(media, 'music', '')).toEqual([tavern, battle]);
    expect(audioLibrary(media, 'ambience', '')).toEqual([rain]);
    expect(audioLibrary(media, 'soundEffect', '')).toEqual([sword]);
  });

  it('combines the filter with a search by name, ignoring case and accents', () => {
    expect(audioLibrary(media, 'all', 'FORET')).toEqual([rain]);
    expect(audioLibrary(media, 'all', 'epee')).toEqual([sword]);
    expect(audioLibrary(media, 'music', 'pluie')).toEqual([]);
    expect(audioLibrary(media, 'music', 'ANIMEE')).toEqual([tavern]);
  });
});

describe('duration', () => {
  it.each([
    [0.4, '0:00'],
    [0.6, '0:01'],
    [7.3, '0:07'],
    [59.6, '1:00'],
    [125, '2:05'],
    [3599, '59:59'],
    [3600, '1:00:00'],
    [3725.2, '1:02:05'],
  ])('shows %s s as %s', (seconds, shown) => {
    expect(formatDuration(seconds)).toBe(shown);
  });

  it('shows a dash when the duration is unknown', () => {
    expect(formatDuration(null)).toBe('–');
  });
});
