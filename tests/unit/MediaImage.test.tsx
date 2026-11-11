// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaImage } from '../../src/MediaImage';

// jsdom loads and decodes no images: the tests fire the image's load / error events themselves,
// as the browser does when the Media address answers 200 or 404, and finish decoding by hand.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ADDRESS = `regie-media://media/campagne/${'a'.repeat(64)}.png`;
const OTHER_ADDRESS = `regie-media://media/campagne/${'b'.repeat(64)}.png`;

let container: HTMLElement;
let root: Root;
/** Finishes decoding the images decoded so far (HTMLImageElement.decode). */
let finishDecoding: () => Promise<void>;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const decoding: (() => void)[] = [];
  HTMLImageElement.prototype.decode = () => new Promise<void>((resolve) => decoding.push(resolve));
  finishDecoding = () =>
    act(async () => {
      decoding.splice(0).forEach((resolve) => resolve());
      await Promise.resolve();
    });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(element: React.ReactElement) {
  act(() => root.render(element));
}

function image() {
  return container.querySelector('img');
}

function fire(type: 'load' | 'error') {
  act(() => {
    const shown = image();
    if (!shown) throw new Error('No image rendered');
    shown.dispatchEvent(new Event(type));
  });
}

describe('a Media image in the Control window', () => {
  it('shows the image while its file loads', () => {
    render(<MediaImage address={ADDRESS} alt="Cantina" window="control" />);

    expect(image()?.getAttribute('src')).toBe(ADDRESS);
    expect(image()?.alt).toBe('Cantina');
  });

  it('shows a "média manquant" placeholder instead of a broken image when the file is missing', () => {
    render(<MediaImage address={ADDRESS} alt="Cantina" window="control" />);
    fire('error');

    expect(image()).toBeNull();
    const placeholder = container.querySelector('[role="img"]');
    expect(placeholder?.getAttribute('aria-label')).toBe('Média manquant : Cantina');
    expect(container.textContent).toContain('Média manquant');
  });

  it('names the placeholder plainly for a decorative image', () => {
    render(<MediaImage address={ADDRESS} alt="" window="control" />);
    fire('error');

    expect(container.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(
      'Média manquant',
    );
  });

  it('tries again when it is given another address', () => {
    render(<MediaImage address={ADDRESS} alt="Cantina" window="control" />);
    fire('error');
    render(<MediaImage address={OTHER_ADDRESS} alt="Cantina" window="control" />);

    expect(image()?.getAttribute('src')).toBe(OTHER_ADDRESS);
    expect(container.textContent).not.toContain('Média manquant');
  });
});

describe('a Media image in the Broadcast window', () => {
  it('keeps the image hidden until its file has loaded and is decoded', async () => {
    render(<MediaImage address={ADDRESS} alt="" window="broadcast" />);
    expect(image()?.hidden).toBe(true);

    fire('load');
    expect(image()?.hidden).toBe(true);
    await finishDecoding();
    expect(image()?.hidden).toBe(false);
  });

  it('reports its natural size once loaded, and that it can be drawn whole once decoded', async () => {
    const loaded = vi.fn();
    const decoded = vi.fn();
    render(
      <MediaImage
        address={ADDRESS}
        alt=""
        window="broadcast"
        onLoad={loaded}
        onDecoded={decoded}
      />,
    );
    fire('load');
    expect(loaded).toHaveBeenCalledTimes(1);
    expect(decoded).not.toHaveBeenCalled();

    await finishDecoding();
    expect(decoded).toHaveBeenCalledTimes(1);
  });

  it('shows nothing at all when the file is missing', () => {
    render(<MediaImage address={ADDRESS} alt="" window="broadcast" />);
    fire('error');

    expect(container.innerHTML).toBe('');
  });

  it('never shows the placeholder text to players', () => {
    render(<MediaImage address={ADDRESS} alt="Cantina" window="broadcast" />);
    fire('error');

    expect(container.textContent).toBe('');
  });
});
