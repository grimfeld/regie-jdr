import { describe, expect, it } from 'vitest';
import { placeWindow } from '../../core/windowPlacement';

// Work areas (screen minus taskbar) as Electron's `screen` reports them.
const primary = { x: 0, y: 0, width: 1920, height: 1040 };
const leftScreen = { x: -1920, y: 0, width: 1920, height: 1040 };

describe('placeWindow', () => {
  it('has nothing to restore when no bounds were saved', () => {
    expect(placeWindow(undefined, [primary])).toBeUndefined();
  });

  it('restores bounds that are on a display', () => {
    const saved = { x: 100, y: 50, width: 1200, height: 800 };
    expect(placeWindow(saved, [primary])).toEqual(saved);
  });

  it('restores bounds on a second display that is still connected', () => {
    const saved = { x: -1500, y: 100, width: 1280, height: 720 };
    expect(placeWindow(saved, [primary, leftScreen])).toEqual(saved);
  });

  it('keeps a window that is only partly off-screen where it was', () => {
    const saved = { x: 1700, y: 900, width: 1280, height: 720 };
    expect(placeWindow(saved, [primary])).toEqual(saved);
  });

  it('brings a window from a disconnected display back to the centre of the first display', () => {
    const saved = { x: -1500, y: 100, width: 1280, height: 720 };
    expect(placeWindow(saved, [primary])).toEqual({ x: 320, y: 160, width: 1280, height: 720 });
  });

  it('shrinks a window larger than the display it is brought back to', () => {
    const saved = { x: 5000, y: 5000, width: 2560, height: 1440 };
    expect(placeWindow(saved, [primary])).toEqual({ x: 0, y: 0, width: 1920, height: 1040 });
  });

  it('brings back a window whose visible sliver is too small to grab', () => {
    // Only 10 px of the window reach the display: it cannot be dragged back by hand.
    const saved = { x: 1910, y: 100, width: 800, height: 600 };
    expect(placeWindow(saved, [primary])).toEqual({ x: 560, y: 220, width: 800, height: 600 });
  });
});
