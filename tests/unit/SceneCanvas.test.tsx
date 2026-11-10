// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SceneCanvas, type Picture } from '../../src/SceneCanvas';

// jsdom loads and decodes no images: the tests fire `load` and finish decoding by hand.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SRC = `regie-media://media/campagne/${'a'.repeat(64)}.png`;
const FADE = 1000;

let container: HTMLElement;
let root: Root;
let decoding: (() => void)[];

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  decoding = [];
  HTMLImageElement.prototype.decode = () => new Promise<void>((resolve) => decoding.push(resolve));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

function draw(picture: Picture | null, blackout = false) {
  act(() =>
    root.render(
      <SceneCanvas
        picture={picture}
        blackout={blackout}
        window="broadcast"
        fadeDurationMs={FADE}
      />,
    ),
  );
}

/** Each element matching `selector`: its fade state and text. */
function drawn(selector: string) {
  return [...container.querySelectorAll(selector)].map((element) => ({
    fade: element.getAttribute('data-fade'),
    text: element.textContent,
  }));
}

/** Loads and decodes every image drawn so far. */
async function loadImages() {
  act(() => {
    for (const image of container.querySelectorAll('img')) image.dispatchEvent(new Event('load'));
  });
  await act(async () => {
    decoding.splice(0).forEach((resolve) => resolve());
    await Promise.resolve();
  });
}

function fadeOut() {
  act(() => {
    vi.advanceTimersByTime(FADE);
  });
}

const overlay = (label?: string) => ({
  id: 'o1',
  src: SRC,
  position: { x: 0.5, y: 0.5 },
  height: 0.5,
  ...(label !== undefined && { label }),
});

describe('the renderer’s fades', () => {
  it('fades the stage over the fade duration', () => {
    draw(null);
    const stage = container.querySelector<HTMLElement>('.scene-canvas-stage');
    expect(stage?.style.getPropertyValue('--fade-duration')).toBe('1000ms');
  });

  it('keeps an image transparent until it is decoded, then fades it in', async () => {
    draw({ backgrounds: [], overlays: [overlay()] });
    expect(drawn('.canvas-overlay')).toEqual([{ fade: 'waiting', text: '' }]);

    await loadImages();
    expect(drawn('.canvas-overlay')).toEqual([{ fade: 'shown', text: '' }]);
  });

  it('fades out a placement the broadcast no longer has, from what it last drew', async () => {
    draw({ backgrounds: [], overlays: [overlay('Garde')] });
    await loadImages();

    draw({ backgrounds: [], overlays: [] });
    expect(drawn('.canvas-overlay')).toEqual([{ fade: 'leaving', text: 'Garde' }]);
    expect(container.querySelector('.canvas-overlay img')?.getAttribute('src')).toBe(SRC);

    fadeOut();
    expect(drawn('.canvas-overlay')).toEqual([]);
  });

  it('brings back a placement shown again while it fades out', async () => {
    draw({ backgrounds: [], overlays: [overlay()] });
    await loadImages();
    draw({ backgrounds: [], overlays: [] });
    draw({ backgrounds: [], overlays: [overlay()] });

    expect(drawn('.canvas-overlay')).toEqual([{ fade: 'shown', text: '' }]);
    fadeOut();
    expect(drawn('.canvas-overlay')).toEqual([{ fade: 'shown', text: '' }]);
  });

  it('fades a Label out when it is hidden, and from one text to the next when it changes', async () => {
    draw({ backgrounds: [], overlays: [overlay('Garde')] });
    await loadImages();
    expect(drawn('.canvas-label')).toEqual([{ fade: 'shown', text: 'Garde' }]);

    draw({ backgrounds: [], overlays: [overlay('Capitaine')] });
    expect(drawn('.canvas-label')).toEqual([
      { fade: 'leaving', text: 'Garde' },
      { fade: 'shown', text: 'Capitaine' },
    ]);

    draw({ backgrounds: [], overlays: [overlay()] });
    fadeOut();
    expect(drawn('.canvas-label')).toEqual([]);
  });

  it('fades the Scene title in, from one title to the next, and out', () => {
    draw({ backgrounds: [], overlays: [], title: 'Le vieux moulin' });
    expect(drawn('.canvas-title')).toEqual([{ fade: 'shown', text: 'Le vieux moulin' }]);

    draw({ backgrounds: [], overlays: [], title: 'La forêt' });
    expect(drawn('.canvas-title')).toEqual([
      { fade: 'leaving', text: 'Le vieux moulin' },
      { fade: 'shown', text: 'La forêt' },
    ]);

    draw({ backgrounds: [], overlays: [] });
    fadeOut();
    expect(drawn('.canvas-title')).toEqual([]);
  });

  it('fades Blackout in and out', () => {
    draw(null, true);
    expect(drawn('.canvas-blackout')).toEqual([{ fade: 'shown', text: '' }]);

    draw(null, false);
    expect(drawn('.canvas-blackout')).toEqual([{ fade: 'leaving', text: '' }]);
    fadeOut();
    expect(drawn('.canvas-blackout')).toEqual([]);
  });
});
