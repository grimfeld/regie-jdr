/**
 * Layout of the fixed 16:9 canvas (ADR-0003): where the canvas sits in a window (letterboxed,
 * centred) and where each Background and Overlay is drawn on it, in window pixels. Pure, with
 * no DOM or Electron dependency: the one renderer (src/SceneCanvas.tsx) used by the editor, the
 * On-air monitor and the Broadcast window paints exactly what this returns, so all three match.
 *
 * Scenes store positions and sizes as fractions of the canvas, never pixels.
 */
import type { BackgroundFit, NormalizedPoint } from '../shared/domain.js';

/** The logical canvas, in canvas units: 16:9. */
export const CANVAS = { width: 1920, height: 1080 } as const;

export interface Size {
  width: number;
  height: number;
}

/** A rectangle in pixels. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What the layout needs of a Background. `image` is the image's natural size, once known. */
export interface CanvasBackground {
  id: string;
  image: Size | undefined;
  fit: BackgroundFit;
  zoom: number;
  focus: NormalizedPoint;
}

/** What the layout needs of an Overlay. `image` is the image's natural size, once known. */
export interface CanvasOverlay {
  id: string;
  image: Size | undefined;
  /** Centre, as fractions of the canvas. */
  position: NormalizedPoint;
  /** As a fraction of the canvas height; the width follows the image's proportions. */
  height: number;
}

export interface CanvasPicture {
  backgrounds: readonly CanvasBackground[];
  overlays: readonly CanvasOverlay[];
}

export interface CanvasLayout {
  /** The canvas inside the window: the rest of the window is the black bars. */
  canvas: Box;
  /** Window pixels per canvas unit. */
  scale: number;
  /**
   * Each Background's image box, by id, relative to the canvas's top-left corner (it may spill
   * past the canvas, which crops it). A placement whose image size is not known yet is absent.
   */
  backgrounds: Record<string, Box>;
  /** Each Overlay's box, by id, relative to the canvas's top-left corner. Same rule. */
  overlays: Record<string, Box>;
  /** A point in window pixels as fractions of the canvas (outside the canvas: below 0 or above 1). */
  toCanvas(point: { x: number; y: number }): NormalizedPoint;
}

/**
 * Lays out a picture in a window of `window` pixels.
 *
 * - The canvas is the largest 16:9 box that fits, centred.
 * - A Background is scaled to cover (or, in Contain, fit inside) the canvas, times its zoom.
 *   Its focal point picks which part shows where the image is larger than the canvas: 0 aligns
 *   the image's left (top) edge with the canvas's, 1 its right (bottom) edge, 0.5 centres it.
 *   So panning never uncovers the canvas in Cover.
 * - An Overlay is centred on its position, its height a fraction of the canvas height.
 */
export function layOutCanvas(window: Size, picture: CanvasPicture): CanvasLayout {
  const scale = Math.max(0, Math.min(window.width / CANVAS.width, window.height / CANVAS.height));
  const width = CANVAS.width * scale;
  const height = CANVAS.height * scale;
  const canvas: Box = {
    x: (window.width - width) / 2,
    y: (window.height - height) / 2,
    width,
    height,
  };

  const backgrounds: Record<string, Box> = {};
  for (const { id, image, fit, zoom, focus } of picture.backgrounds) {
    if (!hasArea(image)) continue;
    const fill = fit === 'cover' ? Math.max : Math.min;
    const imageScale = fill(width / image.width, height / image.height) * zoom;
    const drawn = { width: image.width * imageScale, height: image.height * imageScale };
    backgrounds[id] = {
      // `+ 0` turns -0 (an edge-aligned focal point) into 0.
      x: (width - drawn.width) * focus.x + 0,
      y: (height - drawn.height) * focus.y + 0,
      ...drawn,
    };
  }

  const overlays: Record<string, Box> = {};
  for (const { id, image, position, height: fraction } of picture.overlays) {
    if (!hasArea(image)) continue;
    const boxHeight = height * fraction;
    const boxWidth = (boxHeight * image.width) / image.height;
    overlays[id] = {
      x: width * position.x - boxWidth / 2,
      y: height * position.y - boxHeight / 2,
      width: boxWidth,
      height: boxHeight,
    };
  }

  return {
    canvas,
    scale,
    backgrounds,
    overlays,
    toCanvas: ({ x, y }) => ({
      x: width > 0 ? (x - canvas.x) / width : 0,
      y: height > 0 ? (y - canvas.y) / height : 0,
    }),
  };
}

function hasArea(size: Size | undefined): size is Size {
  return size !== undefined && size.width > 0 && size.height > 0;
}
