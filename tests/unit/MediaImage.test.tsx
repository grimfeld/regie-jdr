// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MediaImage } from '../../src/MediaImage';

// jsdom loads no images: the tests fire the image's load / error events themselves, as the
// browser does when the Media address answers 200 or 404.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ADDRESS = `regie-media://media/campagne/${'a'.repeat(64)}.png`;
const OTHER_ADDRESS = `regie-media://media/campagne/${'b'.repeat(64)}.png`;

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

function render(element: React.ReactElement) {
  act(() => root.render(element));
}

function image() {
  return container.querySelector('img');
}

function fire(type: 'load' | 'error') {
  act(() => {
    image()!.dispatchEvent(new Event(type));
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
  it('keeps the image hidden until its file has loaded', () => {
    render(<MediaImage address={ADDRESS} alt="" window="broadcast" />);
    expect(image()?.hidden).toBe(true);

    fire('load');
    expect(image()?.hidden).toBe(false);
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
