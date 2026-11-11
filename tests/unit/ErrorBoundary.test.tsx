// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BROADCAST_RETRY_MS, ErrorBoundary } from '../../src/ErrorBoundary';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  // React and the boundary print the error; the tests only look at what the window shows.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function Crashing(): never {
  throw new Error('render failed');
}

/** Whether `Flaky` crashes when rendered. */
let broken = true;

function Flaky() {
  if (broken) throw new Error('render failed');
  return <span>image</span>;
}

describe('a window whose interface crashes', () => {
  it('tells the Game Master in the Control window, with a way to try again', () => {
    act(() =>
      root.render(
        <ErrorBoundary window="control">
          <Crashing />
        </ErrorBoundary>,
      ),
    );

    expect(container.textContent).toContain('Un problème est survenu');
    expect(container.querySelector('button')).not.toBeNull();
  });

  it('shows the players nothing but black in the Broadcast window', () => {
    act(() =>
      root.render(
        <ErrorBoundary window="broadcast">
          <Crashing />
        </ErrorBoundary>,
      ),
    );

    expect(container.textContent).toBe('');
    expect(container.querySelector('button, a, input, select, textarea')).toBeNull();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('render failed'));
  });

  it('starts the Broadcast window again by itself, waiting longer after each crash', () => {
    vi.useFakeTimers();
    try {
      broken = true;
      act(() =>
        root.render(
          <ErrorBoundary window="broadcast">
            <Flaky />
          </ErrorBoundary>,
        ),
      );
      // The first try again, a second later, crashes too: the next waits two seconds.
      act(() => {
        vi.advanceTimersByTime(BROADCAST_RETRY_MS);
      });
      broken = false;
      act(() => {
        vi.advanceTimersByTime(BROADCAST_RETRY_MS);
      });
      expect(container.textContent).toBe('');

      act(() => {
        vi.advanceTimersByTime(BROADCAST_RETRY_MS);
      });
      expect(container.textContent).toBe('image');
    } finally {
      vi.useRealTimers();
    }
  });
});
