// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Background } from '../../shared/domain';
import { BackgroundControls } from '../../src/BackgroundControls';
import { LevelSlider } from '../../src/LevelSlider';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(element: ReactElement) {
  act(() => root.render(element));
}

function slider(name: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`);
  if (!input) throw new Error(`No slider named ${name}.`);
  return input;
}

/** Moves `input` to `value` as a drag does, then releases it. */
function dragAndRelease(input: HTMLInputElement, value: string) {
  act(() => {
    // React tracks the value it last set: set it past React, as the browser does on a drag.
    Reflect.set(HTMLInputElement.prototype, 'value', value, input);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  act(() => {
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
  });
}

/** A handler for what the test does not look at. */
const ignore = () => undefined;

/** A save the test settles itself, the way the main process answers. */
function pendingSave() {
  const save: { settle: () => void } = { settle: ignore };
  const saved = new Promise<void>((resolve) => {
    save.settle = resolve;
  });
  return { saved, settle: () => save.settle() };
}

/*
 * A release saves its value; an undo right after it restores the value the drag started from.
 * When both answers reach the window before it renders again, the slider never sees the
 * released value saved: it must still show the restored one, not the value it released.
 */
describe('a slider released, saved and undone before the window renders again', () => {
  it('a framing slider shows the restored value', async () => {
    const background = (zoom: number): Background => ({
      id: 'carre',
      mediaId: 'm1',
      fit: 'cover',
      zoom,
      focus: { x: 0.5, y: 0.5 },
      visible: true,
    });
    const save = pendingSave();
    const controls = (zoom: number) => (
      <BackgroundControls
        background={background(zoom)}
        index={0}
        count={1}
        name="Carre"
        onEdit={ignore}
        framing={{ onLive: ignore, onRelease: () => save.saved }}
      />
    );
    render(controls(1));
    dragAndRelease(slider('Zoom de Carre'), '4');
    expect(slider('Zoom de Carre').value).toBe('4');

    // The release is saved (zoom 4) and undone (zoom 1) in one render.
    await act(() => {
      save.settle();
      root.render(controls(1));
      return save.saved;
    });

    expect(slider('Zoom de Carre').value).toBe('1');
  });

  it('a level slider shows the restored level', async () => {
    const save = pendingSave();
    const level = (value: number) => (
      <LevelSlider label="Niveau" value={value} onLive={ignore} onCommit={() => save.saved} />
    );
    render(level(0.5));
    dragAndRelease(slider('Niveau'), '90');
    expect(slider('Niveau').value).toBe('90');

    await act(() => {
      save.settle();
      root.render(level(0.5));
      return save.saved;
    });

    expect(slider('Niveau').value).toBe('50');
  });
});
