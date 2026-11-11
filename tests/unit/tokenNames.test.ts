import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { THEMES_DIR, readStylesheet, tokensOf, withoutComments } from './themeStyles';

/*
 * Every `var(--x)` in the window sources names a token of the list (src/themes/tokens.css) or
 * of the canvas (src/themes/unthemed.css), or a value a script sets inline on its element
 * (`style={{ '--canvas-scale': scale }}`). A misspelt or invented name (`var(--accent2)`)
 * is not a colour, so rawColours.test.ts cannot see it, and CSS silently drops the declaration:
 * this test catches it (CODING_STANDARDS.md, "Themes").
 */

const SRC = new URL('../../src/', import.meta.url);
const USE = /var\(\s*(--[\w-]+)/g;
/** A custom property written as a script object key: `'--canvas-scale': scale`. */
const INLINE = /['"](--[\w-]+)['"]\s*:/g;

function windowSources(): { path: string; text: string }[] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .map((path) => path.replaceAll('\\', '/'))
    .filter((path) => /\.(css|ts|tsx)$/.test(path))
    .map((path) => ({ path: `src/${path}`, text: readFileSync(new URL(path, SRC), 'utf8') }));
}

/** The token names `sources` use but that `known` does not hold, as "file name". */
function unknownTokens(
  sources: { path: string; text: string }[],
  known: ReadonlySet<string>,
): string[] {
  return sources.flatMap(({ path, text }) =>
    [...withoutComments(text).matchAll(USE)]
      .map((match) => match[1])
      .filter((name) => !known.has(name))
      .map((name) => `${path} ${name}`),
  );
}

function knownTokens(sources: { path: string; text: string }[]): Set<string> {
  const listed = ['tokens.css', 'unthemed.css'].flatMap((file) => [
    ...tokensOf(readStylesheet(new URL(file, THEMES_DIR)), ':root').keys(),
  ]);
  const inline = sources
    .filter(({ path }) => /\.tsx?$/.test(path))
    .flatMap(({ text }) => [...text.matchAll(INLINE)].map((match) => match[1]));
  return new Set([...listed, ...inline]);
}

describe('token names', () => {
  it('used in the window sources are all defined', () => {
    const sources = windowSources();
    expect(
      unknownTokens(sources, knownTokens(sources)),
      'Use a token of src/themes/tokens.css (or unthemed.css), or add it to the list',
    ).toEqual([]);
  });

  it('are flagged when unknown, and not when listed or in a comment', () => {
    const css = '/* var(--old) */\n.a { color: var(--accent2); border-color: var(--accent); }';
    expect(unknownTokens([{ path: 'x.css', text: css }], new Set(['--accent']))).toEqual([
      'x.css --accent2',
    ]);
  });
});
