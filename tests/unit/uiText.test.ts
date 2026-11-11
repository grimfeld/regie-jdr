import { readdirSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/*
 * UI text is French (CODING_STANDARDS.md, "Language and naming"). This test reads every window
 * source file and flags English words in the text a window shows. It looks only where text
 * reaches the Game Master, to keep false positives rare:
 *  - JSX text and child expressions, and text in the attributes below;
 *  - the text given to showNotice;
 *  - any other string with a space in it (prose), except log and Error messages, which are
 *    English for the developer, and class names.
 * A word counts as English only if it is on the list below: common English words that are not
 * French words. It misses English made only of other words; it is a tripwire, not a translator.
 */

const ENGLISH = new Set(
  (
    'the and with of to your you this that these those is are was were be been has have not ' +
    'for from into please click failed error loading delete cancel save close open add remove ' +
    'show hide select choose create rename settings yes no none missing unknown new back next ' +
    'edit here there will would should could cannot can it its what which when where who ' +
    'scene scenes campaign campaigns background backgrounds overlay overlays sound sounds ' +
    'music library title name broadcast closed opened saved deleted'
  ).split(' '),
);

/** Attributes whose text the Game Master sees or hears (screen readers). */
const TEXT_ATTRIBUTES = new Set([
  'title',
  'aria-label',
  'aria-description',
  'aria-placeholder',
  'aria-valuetext',
  'placeholder',
  'alt',
  'label',
]);

interface EnglishText {
  line: number;
  text: string;
}

function englishWords(text: string): string[] {
  const words = text.toLowerCase().match(/[\p{L}']+/gu) ?? [];
  return words.filter((word) => ENGLISH.has(word));
}

/** The text of a string-like node, template holes left out. */
function textOf(node: ts.Node): string | undefined {
  if (ts.isJsxText(node)) return node.text;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(' ');
  }
  return undefined;
}

/** Whether `node` is inside an argument of a call to a log (console.*) or an Error. */
function inDeveloperMessage(node: ts.Node): boolean {
  for (let at = node.parent as ts.Node | undefined; at; at = at.parent) {
    if (ts.isNewExpression(at) && at.expression.getText().endsWith('Error')) return true;
    if (ts.isCallExpression(at) && /^(console|log)\./.test(at.expression.getText())) return true;
  }
  return false;
}

/** Whether `node` is shown text (a JSX child, a text attribute, a notice) or a class name. */
function textContext(node: ts.Node): 'shown' | 'class' | undefined {
  for (let at = node.parent as ts.Node | undefined; at; at = at.parent) {
    if (ts.isJsxAttribute(at)) {
      const name = at.name.getText();
      if (TEXT_ATTRIBUTES.has(name)) return 'shown';
      return name === 'className' ? 'class' : undefined;
    }
    if (ts.isCallExpression(at) && at.expression.getText() === 'showNotice') return 'shown';
    // A JSX child expression, `{open ? 'Ouverte' : 'Fermée'}`: shown as it is.
    if (ts.isJsxExpression(at) && !ts.isJsxAttribute(at.parent)) return 'shown';
    if (ts.isJsxElement(at) || ts.isJsxSelfClosingElement(at) || ts.isBlock(at)) return undefined;
  }
  return undefined;
}

/** The English UI text in one window source file. */
function findEnglishText(fileName: string, source: string): EnglishText[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const found: EnglishText[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isTypeNode(node)) {
      return;
    }
    const text = textOf(node);
    if (text !== undefined) {
      const context = textContext(node);
      const checked =
        ts.isJsxText(node) ||
        context === 'shown' ||
        (context === undefined && /\S\s+\S/.test(text) && !inDeveloperMessage(node));
      if (checked && englishWords(text).length > 0) {
        const { line } = file.getLineAndCharacterOfPosition(node.getStart());
        found.push({ line: line + 1, text: text.trim() });
      }
      if (ts.isTemplateExpression(node)) {
        for (const span of node.templateSpans) visit(span.expression);
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

function windowSources(): string[] {
  const root = new URL('../../src/', import.meta.url);
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .map((path) => path.replaceAll('\\', '/'))
    .filter((path) => /\.tsx?$/.test(path) && !/\.(test|d)\.tsx?$/.test(path));
}

describe('UI text', () => {
  it('is French in every window source file', () => {
    const root = new URL('../../src/', import.meta.url);
    const sources = windowSources();
    expect(sources.length).toBeGreaterThan(0);
    const english = sources.flatMap((path) =>
      findEnglishText(path, readFileSync(new URL(path, root), 'utf8')).map(
        ({ line, text }) => `src/${path}:${String(line)} ${text}`,
      ),
    );
    expect(english).toEqual([]);
  });

  it('flags English where the Game Master sees it', () => {
    const source = `
      const message = 'Could not open the Campaign';
      export function View() {
        showNotice('Failed');
        return (
          <section aria-label="Scenes">
            <button title={\`Delete \${name}\`}>Cancel</button>
            {open ? 'Scène ouverte' : 'Closed'}
          </section>
        );
      }`;
    expect(findEnglishText('probe.tsx', source).map(({ text }) => text)).toEqual([
      'Could not open the Campaign',
      'Failed',
      'Scenes',
      'Delete',
      'Cancel',
      'Closed',
    ]);
  });

  it('leaves French text, class names, logs, errors and identifiers alone', () => {
    const source = `
      import { open } from './the module';
      type State = 'loading' | 'missing';
      export function View() {
        console.error('Could not load the scene');
        if (!root) throw new Error('index.html has no root element');
        const state = 'missing';
        return (
          <div className="scene-list is-hidden" role="list" data-state={state === 'loading' ? 'new' : 'open'}>
            Scène active · Ajouter en arrière-plan
            <img alt="Média manquant" title="Fantasy" />
          </div>
        );
      }`;
    expect(findEnglishText('probe.tsx', source)).toEqual([]);
  });
});
