import { describe, expect, it } from 'vitest';
import { THEME_IDS } from '../../core/storage/campaigns';
import {
  THEMES_DIR,
  contrast,
  over,
  parseColour,
  readStylesheet,
  resolve,
  tokensOf,
} from './themeStyles';

/*
 * Every theme is readable (spec #58, story 41): each text/background pair of its tokens passes
 * WCAG AA (4.5:1). The token list is src/themes/tokens.css; a theme is the stylesheet
 * src/themes/<id>.css setting every one of those tokens, and nothing on the canvas
 * (src/themes/unthemed.css).
 */

const tokenList = tokensOf(readStylesheet(new URL('tokens.css', THEMES_DIR)), ':root');
const unthemed = tokensOf(readStylesheet(new URL('unthemed.css', THEMES_DIR)), ':root');

function themeTokens(id: string): Map<string, string> {
  return tokensOf(readStylesheet(new URL(`${id}.css`, THEMES_DIR)), `[data-theme='${id}']`);
}

/** The window before its theme applies (tokens.css), then each theme. */
const palettes: [string, Map<string, string>][] = [
  ['before a theme applies', tokenList],
  ...THEME_IDS.map((id): [string, Map<string, string>] => [id, themeTokens(id)]),
];

const AA = 4.5;

/** Surfaces text sits on. */
const BACKGROUNDS = ['--page', '--title-bar', '--surface', '--surface-raised', '--surface-sunken'];
/** Text colours used on any of those surfaces. */
const TEXTS = ['--text', '--text-secondary', '--accent-strong', '--status-error'];
/** Text on its own coloured background. */
const OWN_BACKGROUNDS: [string, string][] = [
  ['--on-accent', '--accent'],
  ['--on-status-live', '--status-live'],
  ['--status-missing', '--status-missing-fill'],
  ['--status-missing', '--status-missing-fill-alt'],
  // The NOIR and "Rien à l’antenne" badges show on the On-air monitor while it is black.
  ['--status-blackout', '--canvas-black'],
];
/** A Hidden item's name (--text) is faded by --status-hidden-opacity on the lists' surfaces. */
const HIDDEN: [string, string][] = [
  ['--text', '--surface'],
  ['--text', '--surface-raised'],
];

describe('the theme token list', () => {
  it('names a token once, either themed or unthemed', () => {
    expect([...tokenList.keys()].filter((name) => unthemed.has(name))).toEqual([]);
  });

  it.each(THEME_IDS)('is what %s sets, no more and no less', (id) => {
    expect([...themeTokens(id).keys()].sort()).toEqual([...tokenList.keys()].sort());
  });
});

describe.each(palettes)('contrast, %s', (_, tokens) => {
  const colour = (name: string) => parseColour(resolve(`var(${name})`, [tokens, unthemed]));
  const ratio = (text: string, background: string, opacity = 1) =>
    Math.round(
      contrast(over(colour(text), colour(background), opacity), colour(background)) * 100,
    ) / 100;
  const pairs: [string, string][] = [
    ...TEXTS.flatMap((text) => BACKGROUNDS.map((bg): [string, string] => [text, bg])),
    ...OWN_BACKGROUNDS,
  ];

  it.each(pairs)('%s on %s passes AA', (text, background) => {
    expect(ratio(text, background)).toBeGreaterThanOrEqual(AA);
  });

  it.each(HIDDEN)('Hidden %s on %s passes AA', (text, background) => {
    const opacity = Number(resolve('var(--status-hidden-opacity)', [tokens]));
    expect(ratio(text, background, opacity)).toBeGreaterThanOrEqual(AA);
  });
});
