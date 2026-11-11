/**
 * Windowing math for a scrolling grid of equal cells: which cells are near the visible area,
 * and how much empty space stands in for the rows that are not rendered.
 */

export interface GridWindow {
  /** Index of the first rendered item. */
  first: number;
  /** Index after the last rendered item. */
  end: number;
  /** Space above the first rendered row, in pixels. */
  paddingTop: number;
  /** Space below the last rendered row, in pixels. */
  paddingBottom: number;
}

/** How many cells of at least `minCellWidth` fit across `width`, with `gap` between them. */
export function gridColumns(width: number, minCellWidth: number, gap: number): number {
  return Math.max(1, Math.floor((width + gap) / (minCellWidth + gap)));
}

/**
 * The items to render: the rows in view plus `overscanRows` rows above and below.
 * `rowHeight` includes the gap between rows.
 */
export function gridWindow(options: {
  itemCount: number;
  columns: number;
  rowHeight: number;
  scrollTop: number;
  viewportHeight: number;
  overscanRows: number;
}): GridWindow {
  const { itemCount, columns, rowHeight, viewportHeight, overscanRows } = options;
  const rows = Math.ceil(itemCount / columns);
  // A scroll position past the end (the list just got shorter) counts as the end.
  const scrollTop = Math.min(options.scrollTop, Math.max(0, rows * rowHeight - viewportHeight));
  const firstRow = Math.max(0, Math.floor(scrollTop / rowHeight) - overscanRows);
  const endRow = Math.min(rows, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscanRows);
  return {
    first: firstRow * columns,
    end: Math.min(itemCount, endRow * columns),
    paddingTop: firstRow * rowHeight,
    paddingBottom: (rows - endRow) * rowHeight,
  };
}
