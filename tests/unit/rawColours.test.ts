import { readdirSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { withoutComments } from './themeStyles';

/*
 * Colours are written only in the theme stylesheets, src/themes/ (CODING_STANDARDS.md,
 * "Themes"): everything else uses their tokens, var(--text), var(--surface)... so a theme
 * restyles the whole Control window from its one file, and the contrast test
 * (themeContrast.test.ts) sees every colour the Game Master reads.
 * This test reads the window sources (src/, index.html) and flags hex colours, colour
 * functions (rgb(), hsl()...) and named colours. `transparent` and `currentColor` are not
 * colours of their own and stay allowed.
 */

const SRC = new URL('../../src/', import.meta.url);
const THEMES = 'themes/';

/** CSS named colours (CSS Color 4), but transparent and currentColor. */
const NAMED = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue ' +
    'blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk ' +
    'crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki ' +
    'darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen ' +
    'darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue ' +
    'dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite ' +
    'gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki ' +
    'lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan ' +
    'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen ' +
    'lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen ' +
    'magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen ' +
    'mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream ' +
    'mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid ' +
    'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum ' +
    'powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown ' +
    'seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen ' +
    'steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'
  ).split(' '),
);

const HEX = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/gi;
const FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/gi;

/** The raw colours written in `text`; with `named`, named colours too. */
function coloursIn(text: string, named: boolean): string[] {
  const found = [...text.matchAll(HEX), ...text.matchAll(FUNCTION)].map((match) => match[0]);
  if (named) {
    found.push(
      ...(text.toLowerCase().match(/(?<![\w-])[a-z]+(?![\w-])/g) ?? []).filter((word) =>
        NAMED.has(word),
      ),
    );
  }
  return found;
}

function lineAt(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

/** In a stylesheet: the values of its declarations (not selectors or property names). */
function cssColours(css: string): { line: number; colour: string }[] {
  // Comments become blanks of the same length, so line numbers stay right.
  const text = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
  return [...text.matchAll(/([-\w]+)\s*:\s*([^;{}]*)(?=[;}])/g)].flatMap((match) =>
    coloursIn(match[2], true).map((colour) => ({ line: lineAt(text, match.index), colour })),
  );
}

/** In a script: its string and template texts; a named colour only as a whole string. */
function scriptColours(path: string, source: string): { line: number; colour: string }[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const found: { line: number; colour: string }[] = [];
  const visit = (node: ts.Node) => {
    let text: string | undefined;
    if (ts.isStringLiteralLike(node) || ts.isJsxText(node)) text = node.text;
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      text = node.text;
    }
    if (text !== undefined) {
      const line = file.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      const colours = coloursIn(text, false);
      if (NAMED.has(text.trim().toLowerCase())) colours.push(text.trim());
      found.push(...colours.map((colour) => ({ line, colour })));
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

function windowSources(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .map((path) => path.replaceAll('\\', '/'))
    .filter((path) => /\.(css|ts|tsx)$/.test(path))
    .filter((path) => !(path.startsWith(THEMES) && path.endsWith('.css')));
}

describe('raw colours', () => {
  it('appear in no window source outside the theme stylesheets (src/themes/*.css)', () => {
    const found: string[] = [];
    for (const path of windowSources()) {
      const source = readFileSync(new URL(path, SRC), 'utf8');
      const colours = path.endsWith('.css') ? cssColours(source) : scriptColours(path, source);
      found.push(...colours.map(({ line, colour }) => `src/${path}:${line} ${colour}`));
    }
    const html = readFileSync(new URL('../index.html', SRC), 'utf8');
    found.push(...coloursIn(withoutComments(html), false).map((colour) => `index.html ${colour}`));
    expect(found, 'Use a theme token from src/themes/tokens.css instead').toEqual([]);
  });

  it('are caught in a stylesheet, as hex, function or name', () => {
    const css =
      '.a { color: #fff; }\n.b { background: rgb(0 0 0 / 0.5); border: 1px solid black; }';
    expect(cssColours(css)).toEqual([
      { line: 1, colour: '#fff' },
      { line: 2, colour: 'rgb(' },
      { line: 2, colour: 'black' },
    ]);
  });

  it('are not mistaken in tokens, property names, selectors or allowed keywords', () => {
    const css =
      '.white-space { white-space: nowrap; color: var(--status-red); }\n' +
      '.b { background: color-mix(in srgb, var(--accent) 9%, transparent); color: currentColor; }';
    expect(cssColours(css)).toEqual([]);
  });

  it('are caught in a script string, and only whole names there', () => {
    const source = "const a = { color: '#c62828' };\nconst b = 'red';\nconst c = 'a red flag';";
    expect(scriptColours('x.tsx', source)).toEqual([
      { line: 1, colour: '#c62828' },
      { line: 2, colour: 'red' },
    ]);
  });
});
