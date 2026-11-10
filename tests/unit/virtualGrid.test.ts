import { describe, expect, it } from 'vitest';
import { gridColumns, gridWindow } from '../../src/virtualGrid';

describe('grid columns', () => {
  it.each([
    [800, 130, 10, 5],
    [130, 130, 10, 1],
    [50, 130, 10, 1],
    [280, 130, 10, 2],
  ])('fits cells across %i px (min %i, gap %i): %i columns', (width, min, gap, expected) => {
    expect(gridColumns(width, min, gap)).toBe(expected);
  });
});

describe('grid window', () => {
  const base = { columns: 4, rowHeight: 100, viewportHeight: 300, overscanRows: 1 };

  it('renders only the rows near the top when scrolled to the top of 500 items', () => {
    expect(gridWindow({ ...base, itemCount: 500, scrollTop: 0 })).toEqual({
      first: 0,
      end: 16,
      paddingTop: 0,
      paddingBottom: (125 - 4) * 100,
    });
  });

  it('renders the rows in view plus one above and below, in the middle', () => {
    expect(gridWindow({ ...base, itemCount: 500, scrollTop: 5000 })).toEqual({
      first: 49 * 4,
      end: 54 * 4,
      paddingTop: 4900,
      paddingBottom: (125 - 54) * 100,
    });
  });

  it('stops at the last item, with a partly filled last row', () => {
    expect(gridWindow({ ...base, itemCount: 10, scrollTop: 0 })).toEqual({
      first: 0,
      end: 10,
      paddingTop: 0,
      paddingBottom: 0,
    });
  });

  it('renders nothing for an empty library', () => {
    expect(gridWindow({ ...base, itemCount: 0, scrollTop: 0 })).toEqual({
      first: 0,
      end: 0,
      paddingTop: 0,
      paddingBottom: 0,
    });
  });

  it('keeps the last rows when scrolled past the end (library shrank)', () => {
    expect(gridWindow({ ...base, itemCount: 8, scrollTop: 5000 })).toEqual({
      first: 0,
      end: 8,
      paddingTop: 0,
      paddingBottom: 0,
    });
    expect(gridWindow({ ...base, itemCount: 40, scrollTop: 5000 })).toMatchObject({
      first: 6 * 4,
      end: 40,
      paddingBottom: 0,
    });
  });
});
