/**
 * What the library shows: the images, filtered by Image category, and the sounds, filtered by
 * audio role, both searched by Media name and optionally narrowed to favourites; and how a
 * sound's duration reads. Pure (no Node or
 * Electron import): the Control window imports it.
 */
import type { AudioMedia, AudioRole, ImageCategory, ImageMedia, Media } from '../shared/domain.js';

/** The image library filter: every image, or one Image category. */
export type LibraryFilter = 'all' | ImageCategory;

/** The audio library filter: every sound, or one role (Music, Ambience, Sound effect). */
export type AudioFilter = 'all' | AudioRole;

/** Letters a search treats as the same: no case, no accents, ligatures spelled out. */
export function searchKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .trim();
}

/** Whether a Media name matches a search: it contains the query, ignoring case and accents. */
export function matchesSearch(name: string, query: string): boolean {
  return searchKey(name).includes(searchKey(query));
}

/** Whether a Media passes the "Favoris" filter: any Media when it is off, favourites when on. */
function passesFavourites(item: Media, favouritesOnly: boolean): boolean {
  return !favouritesOnly || item.favourite;
}

/**
 * The images the library shows for a filter and a search, in library order; only favourites
 * when `favouritesOnly`.
 */
export function imageLibrary(
  media: readonly Media[],
  filter: LibraryFilter,
  query: string,
  favouritesOnly = false,
) {
  return media.filter(
    (item): item is ImageMedia =>
      item.kind === 'image' &&
      (filter === 'all' || item.category === filter) &&
      passesFavourites(item, favouritesOnly) &&
      matchesSearch(item.name, query),
  );
}

/**
 * The sounds the library shows for a filter and a search, in library order; only favourites
 * when `favouritesOnly`.
 */
export function audioLibrary(
  media: readonly Media[],
  filter: AudioFilter,
  query: string,
  favouritesOnly = false,
) {
  return media.filter(
    (item): item is AudioMedia =>
      item.kind === 'audio' &&
      (filter === 'all' || item.role === filter) &&
      passesFavourites(item, favouritesOnly) &&
      matchesSearch(item.name, query),
  );
}

/** A duration as the library shows it: `2:05`, `1:02:05`; a dash when it is unknown. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return '–';
  const total = Math.round(seconds);
  const pad = (n: number) => String(n).padStart(2, '0');
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = pad(total % 60);
  return hours > 0 ? `${hours}:${pad(minutes)}:${rest}` : `${minutes}:${rest}`;
}
