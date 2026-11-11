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

  it('removes a hidden placement after the fade duration, even while another one is dragged live', async () => {
    const guard = { ...overlay(), id: 'o2' };
    const dragged = (x: number) => ({ ...overlay(), position: { x, y: 0.5 } });
    draw({ backgrounds: [], overlays: [dragged(0.5), guard] });
    await loadImages();

    // o2 is hidden while o1 moves on air: a new picture every frame for twice the fade.
    for (let frame = 0; frame < 120; frame++) {
      draw({ backgrounds: [], overlays: [dragged(0.5 - frame / 1000)] });
      act(() => {
        vi.advanceTimersByTime(FADE / 60);
      });
    }

    expect(container.querySelector('[data-overlay-id="o2"]')).toBeNull();
    expect(container.querySelectorAll('[data-overlay-id="o1"]')).toHaveLength(1);
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

describe('a missing Media on the canvas', () => {
  it('shows its placeholder in place of the image in the Control window', () => {
    act(() =>
      root.render(
        <SceneCanvas
          picture={{ backgrounds: [], overlays: [overlay()] }}
          window="control"
          fadeDurationMs={FADE}
        />,
      ),
    );
    act(() => {
      container.querySelector('img')?.dispatchEvent(new Event('error'));
    });

    const placement = container.querySelector<HTMLElement>('.canvas-overlay');
    expect(placement?.querySelector('.media-missing')).not.toBeNull();
    expect(placement?.style.visibility).not.toBe('hidden');
    expect(placement?.getAttribute('data-fade')).toBe('shown');
  });

  it('draws nothing of it in the Broadcast window', () => {
    draw({ backgrounds: [], overlays: [overlay('Garde')] });
    act(() => {
      container.querySelector('img')?.dispatchEvent(new Event('error'));
    });

    const placement = container.querySelector<HTMLElement>('.canvas-overlay');
    expect(placement?.querySelector('.media-missing')).toBeNull();
    expect(placement?.style.visibility).toBe('hidden');
  });
});

describe('a Transition on the broadcast', () => {
  const OTHER = `regie-media://media/campagne/${'b'.repeat(64)}.png`;
  const DISSOLVE = 1500;
  const background = (id: string, src: string) => ({
    id,
    src,
    fit: 'cover' as const,
    zoom: 1,
    focus: { x: 0.5, y: 0.5 },
  });
  const cantina: Picture = { backgrounds: [background('b1', SRC)], overlays: [], title: 'Cantina' };
  const hangar: Picture = { backgrounds: [background('b2', OTHER)], overlays: [], title: 'Hangar' };

  function onAir(picture: Picture | null, id: number | null, blackout = false) {
    act(() =>
      root.render(
        <SceneCanvas
          picture={picture}
          blackout={blackout}
          window="broadcast"
          fadeDurationMs={FADE}
          transition={id === null ? null : { id, durationMs: DISSOLVE }}
        />,
      ),
    );
  }

  /** Each picture layer, bottom first: its phase and the Media addresses it draws. */
  function layers() {
    return [...container.querySelectorAll('.canvas-layer')].map((layer) => ({
      phase: layer.getAttribute('data-transition'),
      srcs: [...layer.querySelectorAll('img')].map((image) => image.getAttribute('src')),
    }));
  }

  function dissolve() {
    act(() => {
      vi.advanceTimersByTime(DISSOLVE);
    });
  }

  it('draws what is on air when it opens, with no dissolve and no fade', async () => {
    onAir(cantina, 3, true);
    expect(layers()).toEqual([{ phase: 'shown', srcs: [SRC] }]);
    await loadImages();
    expect(drawn('.canvas-layer [data-fade]').map(({ fade }) => fade)).toEqual([
      'steady',
      'steady',
    ]);
    expect(drawn('.canvas-blackout')).toEqual([{ fade: 'steady', text: '' }]);
  });

  it('crossfades: the incoming Scene waits for its images, dissolves in, then is drawn alone', async () => {
    onAir(cantina, 1);
    await loadImages();
    onAir(hangar, 2);
    expect(layers()).toEqual([
      { phase: 'shown', srcs: [SRC] },
      { phase: 'waiting', srcs: [OTHER] },
    ]);
    // Never drawn half-done: hidden until decoded, then drawn whole as the layer dissolves.
    expect(drawn('.canvas-layer:last-child .canvas-background')).toEqual([
      { fade: 'pending', text: '' },
    ]);

    dissolve();
    expect(layers()[1]?.phase).toBe('waiting');

    await loadImages();
    expect(layers()[1]?.phase).toBe('dissolving');
    expect(drawn('.canvas-layer:last-child .canvas-background')).toEqual([
      { fade: 'steady', text: '' },
    ]);
    expect(
      container
        .querySelector<HTMLElement>('.canvas-layer:last-child')
        ?.style.getPropertyValue('--transition-duration'),
    ).toBe(`${DISSOLVE}ms`);

    dissolve();
    expect(layers()).toEqual([{ phase: 'shown', srcs: [OTHER] }]);
  });

  it('dissolves the Scene title with the picture', async () => {
    onAir(cantina, 1);
    await loadImages();
    onAir(hangar, 2);
    // Cantina was on air when the renderer started: drawn at once, steady too.
    expect(drawn('.canvas-title')).toEqual([
      { fade: 'steady', text: 'Cantina' },
      { fade: 'steady', text: 'Hangar' },
    ]);
    await loadImages();
    dissolve();
    expect(drawn('.canvas-title')).toEqual([{ fade: 'steady', text: 'Hangar' }]);
  });

  it('fades in from black when nothing was on air', async () => {
    onAir(null, null);
    onAir(cantina, 1);
    expect(layers()).toEqual([
      { phase: 'shown', srcs: [] },
      { phase: 'waiting', srcs: [SRC] },
    ]);
    await loadImages();
    dissolve();
    expect(layers()).toEqual([{ phase: 'shown', srcs: [SRC] }]);
  });

  it('starts from the frame on screen when Activated mid-Transition: the dissolve pauses', async () => {
    onAir(cantina, 1);
    await loadImages();
    onAir(hangar, 2);
    await loadImages();
    act(() => {
      vi.advanceTimersByTime(DISSOLVE / 2);
    });

    onAir(cantina, 3);
    expect(layers().map((layer) => layer.phase)).toEqual(['shown', 'frozen', 'waiting']);
    await loadImages();
    dissolve();
    expect(layers()).toEqual([{ phase: 'shown', srcs: [SRC] }]);
  });

  it('drops an incoming Scene nobody saw yet when another is Activated', async () => {
    onAir(cantina, 1);
    await loadImages();
    onAir(hangar, 2);
    onAir({ ...cantina, title: 'Cantina, plus tard' }, 3);
    expect(layers().map((layer) => layer.phase)).toEqual(['shown', 'waiting']);
  });

  it('starts the dissolve when an incoming image is missing: nothing to wait for', async () => {
    onAir(cantina, 1);
    await loadImages();
    onAir(hangar, 2);
    act(() => {
      container.querySelector('.canvas-layer:last-child img')?.dispatchEvent(new Event('error'));
    });
    expect(layers()[1]?.phase).toBe('dissolving');
  });

  it('keeps Blackout above the Transition, which runs underneath', async () => {
    onAir(cantina, 1, true);
    await loadImages();
    onAir(hangar, 2, true);
    await loadImages();
    const stage = container.querySelector('.scene-canvas-stage');
    expect(stage?.lastElementChild?.className).toBe('canvas-blackout');
    dissolve();
    expect(layers()).toEqual([{ phase: 'shown', srcs: [OTHER] }]);
    // On when the renderer started: drawn at once, as it was on air already.
    expect(drawn('.canvas-blackout')).toEqual([{ fade: 'steady', text: '' }]);
  });

  it('fades an edit of the Active Scene item by item, with no Transition', async () => {
    onAir(cantina, 1);
    await loadImages();
    onAir({ ...cantina, title: undefined }, 1);
    expect(layers()).toEqual([{ phase: 'shown', srcs: [SRC] }]);
    expect(drawn('.canvas-title')).toEqual([{ fade: 'leaving', text: 'Cantina' }]);
  });
});
