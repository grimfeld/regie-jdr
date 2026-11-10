/**
 * What the image library shows: images only (audio stays out of it), filtered by Image
 * category and searched by Media name. Pure (no Node or Electron import): the Control window
 * imports it.
 */
import type { ImageCategory, ImageMedia, Media } from '../shared/domain.js';

/** The library filter: every image, or one Image category. */
export type LibraryFilter = 'all' | ImageCategory;

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

/** The images the library shows for a filter and a search, in library order. */
export function imageLibrary(media: readonly Media[], filter: LibraryFilter, query: string) {
  return media.filter(
    (item): item is ImageMedia =>
      item.kind === 'image' &&
      (filter === 'all' || item.category === filter) &&
      matchesSearch(item.name, query),
  );
}
