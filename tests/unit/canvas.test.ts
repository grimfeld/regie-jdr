import { describe, expect, it } from 'vitest';
import { CANVAS, layOutCanvas, type CanvasPicture } from '../../core/canvas';

const empty: CanvasPicture = { backgrounds: [], overlays: [] };

describe('the 16:9 canvas in a window', () => {
  it('fills a 16:9 window exactly', () => {
    expect(layOutCanvas({ width: 1920, height: 1080 }, empty).canvas).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    });
  });

  it('is letterboxed with bars above and below in a taller window', () => {
    expect(layOutCanvas({ width: 800, height: 600 }, empty).canvas).toEqual({
      x: 0,
      y: 75,
      width: 800,
      height: 450,
    });
  });

  it('is letterboxed with bars left and right in a wider window', () => {
    expect(layOutCanvas({ width: 3440, height: 1440 }, empty).canvas).toEqual({
      x: 440,
      y: 0,
      width: 2560,
      height: 1440,
    });
  });

  it('keeps 16:9 in a window a third of the screen wide', () => {
    const { canvas } = layOutCanvas({ width: 640, height: 1040 }, empty);
    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(360);
    expect(canvas.y).toBe(340);
  });

  it('is empty in a window of no size', () => {
    expect(layOutCanvas({ width: 0, height: 300 }, empty).canvas).toMatchObject({
      width: 0,
      height: 0,
    });
  });

  it('turns a window point into a canvas fraction', () => {
    const layout = layOutCanvas({ width: 800, height: 600 }, empty);
    expect(layout.toCanvas({ x: 400, y: 300 })).toEqual({ x: 0.5, y: 0.5 });
    expect(layout.toCanvas({ x: 0, y: 75 })).toEqual({ x: 0, y: 0 });
    expect(layout.toCanvas({ x: 800, y: 525 })).toEqual({ x: 1, y: 1 });
  });

  it('gives the scale from canvas units to window pixels', () => {
    expect(layOutCanvas({ width: 960, height: 1000 }, empty).scale).toBe(960 / CANVAS.width);
  });
});

describe('a Background on the canvas', () => {
  const window = { width: 1920, height: 1080 };
  const background = (
    image: { width: number; height: number } | undefined,
    fit: 'cover' | 'contain',
    zoom = 1,
    focus = { x: 0.5, y: 0.5 },
  ) => layOutCanvas(window, { backgrounds: [{ id: 'b', image, fit, zoom, focus }], overlays: [] });

  it('in Cover, fills the canvas, centred, cropping the excess', () => {
    // A square image: scaled to the canvas width, cropped above and below.
    expect(background({ width: 1000, height: 1000 }, 'cover').backgrounds.b).toEqual({
      x: 0,
      y: -420,
      width: 1920,
      height: 1920,
    });
  });

  it('in Contain, shows the whole image, centred', () => {
    expect(background({ width: 1000, height: 1000 }, 'contain').backgrounds.b).toEqual({
      x: 420,
      y: 0,
      width: 1080,
      height: 1080,
    });
  });

  it('zooms around the focal point', () => {
    expect(background({ width: 1920, height: 1080 }, 'cover', 2).backgrounds.b).toEqual({
      x: -960,
      y: -540,
      width: 3840,
      height: 2160,
    });
  });

  it('pans to the focal point without ever uncovering the canvas', () => {
    const topLeft = background({ width: 1920, height: 1080 }, 'cover', 2, { x: 0, y: 0 });
    expect(topLeft.backgrounds.b).toMatchObject({ x: 0, y: 0 });
    const bottomRight = background({ width: 1920, height: 1080 }, 'cover', 2, { x: 1, y: 1 });
    expect(bottomRight.backgrounds.b).toMatchObject({ x: -1920, y: -1080 });
  });

  it('is scaled with the canvas in a smaller window', () => {
    const small = layOutCanvas(
      { width: 960, height: 540 },
      {
        backgrounds: [
          {
            id: 'b',
            image: { width: 1000, height: 1000 },
            fit: 'contain',
            zoom: 1,
            focus: { x: 0.5, y: 0.5 },
          },
        ],
        overlays: [],
      },
    );
    expect(small.backgrounds.b).toEqual({ x: 210, y: 0, width: 540, height: 540 });
  });

  it('has no place until its image size is known', () => {
    expect(background(undefined, 'cover').backgrounds).toEqual({});
  });
});

describe('an Overlay on the canvas', () => {
  const overlay = (
    window: { width: number; height: number },
    image: { width: number; height: number } | undefined,
    position = { x: 0.5, y: 0.5 },
    height = 0.5,
  ) =>
    layOutCanvas(window, { backgrounds: [], overlays: [{ id: 'o', image, position, height }] })
      .overlays.o;

  it('is a fraction of the canvas height, its width following the image proportions', () => {
    // Half the canvas height (540), an image twice as tall as wide: 270 wide.
    expect(overlay({ width: 1920, height: 1080 }, { width: 100, height: 200 })).toEqual({
      x: 825,
      y: 270,
      width: 270,
      height: 540,
    });
  });

  it('is centred on its position', () => {
    expect(
      overlay({ width: 1920, height: 1080 }, { width: 100, height: 100 }, { x: 0, y: 1 }, 0.2),
    ).toEqual({ x: -108, y: 972, width: 216, height: 216 });
  });

  it('keeps its place on the canvas whatever the window shape', () => {
    // Letterboxed 800x600 window: canvas 800x450. The box is relative to the canvas.
    expect(overlay({ width: 800, height: 600 }, { width: 100, height: 100 })).toEqual({
      x: 287.5,
      y: 112.5,
      width: 225,
      height: 225,
    });
  });

  it('has no place until its image size is known', () => {
    expect(overlay({ width: 1920, height: 1080 }, undefined)).toBeUndefined();
  });
});
