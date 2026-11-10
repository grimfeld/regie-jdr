/**
 * Where to reopen a window from its saved bounds, given the displays connected now.
 * Pure: the main process passes the work areas from Electron's `screen`.
 */
import type { WindowBounds } from '../shared/domain.js';

/** A rectangle on the virtual desktop (a display's work area). */
export type Area = WindowBounds;

/** How much of a window must be on a display for the Game Master to grab it and move it. */
const MIN_VISIBLE_WIDTH = 100;
const MIN_VISIBLE_HEIGHT = 50;

function isGrabbable(bounds: WindowBounds, area: Area): boolean {
  const width = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
  const height =
    Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
  return width >= MIN_VISIBLE_WIDTH && height >= MIN_VISIBLE_HEIGHT;
}

/**
 * The saved bounds when enough of the window is on a connected display; otherwise the window
 * is brought back to the centre of the first display (the primary one), shrunk to fit it.
 * Undefined when nothing was saved (the window keeps its default placement).
 */
export function placeWindow(
  saved: WindowBounds | undefined,
  displays: readonly Area[],
): WindowBounds | undefined {
  if (!saved) return undefined;
  if (displays.length === 0 || displays.some((area) => isGrabbable(saved, area))) return saved;
  const area = displays[0];
  const width = Math.min(saved.width, area.width);
  const height = Math.min(saved.height, area.height);
  return {
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + Math.round((area.height - height) / 2),
    width,
    height,
  };
}
