import { readFileSync } from 'node:fs';

/*
 * Reading the theme stylesheets (src/themes/) for the theme tests: their tokens, resolved to
 * colours, and the WCAG contrast between two colours. Plain text parsing: the stylesheets are
 * flat rules of custom properties, written for it.
 */

export const THEMES_DIR = new URL('../../src/themes/', import.meta.url);

export function readStylesheet(url: URL): string {
  return readFileSync(url, 'utf8');
}

export function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** The rules of a flat stylesheet: selector and declarations, in order. */
export function rulesOf(css: string): { selector: string; declarations: [string, string][] }[] {
  return [...withoutComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
    selector: selector.trim(),
    declarations: body
      .split(';')
      .map((declaration) => declaration.trim())
      .filter(Boolean)
      .map((declaration) => {
        const colon = declaration.indexOf(':');
        return [declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()];
      }),
  }));
}

/** The custom properties (tokens) a stylesheet sets under `selector`. */
export function tokensOf(css: string, selector: string): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const rule of rulesOf(css)) {
    if (rule.selector !== selector) continue;
    for (const [property, value] of rule.declarations) {
      if (property.startsWith('--')) tokens.set(property, value);
    }
  }
  return tokens;
}

/** A token's value with every `var(--x)` replaced by x's value, looked up in `scopes` in order. */
export function resolve(value: string, scopes: Map<string, string>[], depth = 0): string {
  if (depth > 10) throw new Error(`Token reference loop in "${value}"`);
  return value.replace(/var\((--[\w-]+)\)/g, (_, name: string) => {
    const found = scopes.find((scope) => scope.has(name))?.get(name);
    if (found === undefined) throw new Error(`Unknown token ${name}`);
    return resolve(found, scopes, depth + 1);
  });
}

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** A colour written as hex or rgb()/rgba(), as the theme stylesheets write them. */
export function parseColour(text: string): Rgba {
  const value = text.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(value)?.[1];
  if (hex && [3, 4, 6, 8].includes(hex.length)) {
    const digits = hex.length <= 4 ? hex.replace(/./g, '$&$&') : hex;
    const [r, g, b, a = 255] = (digits.match(/../g) ?? []).map((pair) => parseInt(pair, 16));
    return { r, g, b, a: a / 255 };
  }
  const fn = /^rgba?\(([^)]*)\)$/.exec(value)?.[1];
  if (fn) {
    const parts = fn.split(/[\s,/]+/).filter(Boolean);
    const [r, g, b] = parts.slice(0, 3).map(Number);
    const alpha = parts.length > 3 ? parts[3] : '1';
    const a = alpha.endsWith('%') ? parseFloat(alpha) / 100 : Number(alpha);
    if ([r, g, b, a].every(Number.isFinite)) return { r, g, b, a };
  }
  throw new Error(`Not a colour the theme tests can read: "${text}"`);
}

/** `top` with its alpha (times `opacity`) painted over the opaque `bottom`. */
export function over(top: Rgba, bottom: Rgba, opacity = 1): Rgba {
  const a = top.a * opacity;
  const mix = (front: number, back: number) => front * a + back * (1 - a);
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: 1 };
}

function luminance({ r, g, b }: Rgba): number {
  const [lr, lg, lb] = [r, g, b].map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

/** WCAG 2 contrast ratio between two opaque colours, 1 to 21. */
export function contrast(a: Rgba, b: Rgba): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}
