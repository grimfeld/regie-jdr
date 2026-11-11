// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BroadcastBridge } from '../../shared/contract';
import type { OnAirState } from '../../shared/domain';
import BroadcastView from '../../src/BroadcastView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SRC = `regie-media://media/campagne/${'a'.repeat(64)}.png`;

/** Mid-session: a Scene on air for a while, under Blackout, its Crossfade long over. */
const midSession: OnAirState = {
  campaignId: 'c1',
  activeSceneId: 's1',
  scene: {
    backgrounds: [{ id: 'b1', src: SRC, fit: 'cover', zoom: 1, focus: { x: 0.5, y: 0.5 } }],
    overlays: [],
  },
  blackout: true,
  fadeDurationMs: 600,
  transition: {
    id: 4,
    kind: 'crossfade',
    from: null,
    to: 's1',
    startedAt: Date.now() - 60_000,
    durationMs: 1500,
  },
  version: 9,
};

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  HTMLImageElement.prototype.decode = () => Promise.resolve();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the Broadcast window opened or reloaded mid-session', () => {
  it('shows what is on air at once: no Transition replayed from black, Blackout already on', async () => {
    let answer: (state: OnAirState) => void = () => undefined;
    const bridge: BroadcastBridge = {
      getOnAir: () => new Promise((resolve) => (answer = resolve)),
      onOnAirChanged: () => () => undefined,
    };
    act(() => root.render(<BroadcastView bridge={bridge} />));

    await act(async () => {
      answer(midSession);
      await Promise.resolve();
    });
    act(() => {
      for (const image of container.querySelectorAll('img')) {
        image.dispatchEvent(new Event('load'));
      }
    });
    await act(() => Promise.resolve());

    const layers = [...container.querySelectorAll('.canvas-layer')];
    expect(layers.map((layer) => layer.getAttribute('data-transition'))).toEqual(['shown']);
    const fades = (selector: string) =>
      [...container.querySelectorAll(selector)].map((item) => item.getAttribute('data-fade'));
    expect(fades('.canvas-layer [data-fade]')).toEqual(['steady']);
    expect(fades('.canvas-blackout')).toEqual(['steady']);
  });
});
