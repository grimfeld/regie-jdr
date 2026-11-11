/**
 * Scene Notes: rich text stored as the Notes editor's ProseMirror JSON document (ADR-0004).
 * Private to the Game Master: no part of the Notes is ever projected on air (core/onAir.ts).
 *
 * What the Notes may hold is the same list the editor is built with (src/SceneNotes.tsx): two
 * heading levels, paragraphs, bold, italic, bullet and numbered lists, checklists, quotes and
 * images. An image is a block holding a Media id, never a file path or embedded data: the image
 * is an ordinary Media of the Campaign library (ADR-0004).
 * `parseNotes` checks a document from untrusted data (a stored file or a window message) against
 * it, keeping only the fields it knows. No Node dependency: the windows run this module.
 *
 * Adding a kind of content: a row of BLOCK_NODES with its attributes and the same extension in
 * the editor. The Media reference scan (#54) reads `mediaId` off the image nodes.
 */
import type { NotesDocument, NotesMark, NotesNode } from '../shared/domain.js';
import { isRecord } from './guards.js';

/** Largest Notes document, in characters of JSON. */
export const MAX_NOTES_SIZE = 1_000_000;
/** Deepest nesting of nodes below the document (quotes and lists inside each other). */
export const MAX_NOTES_DEPTH = 40;

type Attrs = NonNullable<NotesNode['attrs']>;

interface NodeRule {
  /**
   * What the node holds: nothing (`none`), text (`inline`, may be empty), block nodes
   * (`blocks`, at least one, the first a paragraph when `paragraphFirst`), or list items
   * (`items`: their one type and rule, at least one).
   */
  content: 'none' | 'inline' | 'blocks' | { items: Readonly<Record<string, NodeRule>> };
  paragraphFirst?: boolean;
  /** Its attributes, checked and kept; absent: it has none. */
  attrs?: (attrs: Record<string, unknown>) => Attrs | undefined;
}

/** List items: they stand only inside their list. */
const LIST_ITEM: NodeRule = { content: 'blocks', paragraphFirst: true };
const TASK_ITEM: NodeRule = {
  content: 'blocks',
  paragraphFirst: true,
  attrs: ({ checked }) => (typeof checked === 'boolean' ? { checked } : undefined),
};

/** A Media id as the library makes them (a lower-case UUID): never a path or an address. */
const MEDIA_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Whether `value` is a Media id an image in the Notes may hold. */
export function isNotesMediaId(value: unknown): value is string {
  return typeof value === 'string' && MEDIA_ID.test(value);
}

/** Narrowest and widest an image in the Notes may be, in % of the width it stands in. */
export const MIN_NOTES_IMAGE_WIDTH = 10;
export const MAX_NOTES_IMAGE_WIDTH = 100;

/** Whether `value` is a width an image in the Notes may have: a whole % from 10 to 100. */
export function isNotesImageWidth(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_NOTES_IMAGE_WIDTH &&
    value <= MAX_NOTES_IMAGE_WIDTH
  );
}

/**
 * An image's attributes: its Media id and, once the Game Master has resized it, its width in % of
 * the width it stands in (the Notes panel, or the quote or list holding it). No width, or a null
 * one as the editor saves it: the default size, the image's own width up to the whole panel.
 */
function imageAttrs({ mediaId, width = null }: Record<string, unknown>): Attrs | undefined {
  if (!isNotesMediaId(mediaId)) return undefined;
  if (width === null) return { mediaId };
  return isNotesImageWidth(width) ? { mediaId, width } : undefined;
}

const ORDERED_LIST_TYPES: readonly (string | null)[] = [null, '1', 'a', 'A', 'i', 'I'];

/** Nodes that may stand at block level: in the document, a quote or a list item. */
const BLOCK_NODES: Readonly<Record<string, NodeRule>> = {
  paragraph: { content: 'inline' },
  heading: {
    content: 'inline',
    attrs: ({ level }) => (level === 1 || level === 2 ? { level } : undefined),
  },
  blockquote: { content: 'blocks' },
  bulletList: { content: { items: { listItem: LIST_ITEM } } },
  orderedList: {
    content: { items: { listItem: LIST_ITEM } },
    attrs: ({ start = 1, type = null }) =>
      typeof start === 'number' &&
      Number.isSafeInteger(start) &&
      (typeof type === 'string' || type === null) &&
      ORDERED_LIST_TYPES.includes(type)
        ? { start, type }
        : undefined,
  },
  taskList: { content: { items: { taskItem: TASK_ITEM } } },
  image: {
    content: 'none',
    attrs: imageAttrs,
  },
};

const MARKS: readonly NotesMark['type'][] = ['bold', 'italic'];

/** Empty Notes: one empty paragraph, as the editor starts. */
export function emptyNotes(): NotesDocument {
  return { type: 'doc', content: [{ type: 'paragraph' }] };
}

/**
 * Notes from plain text (Notes before rich text, scenes.json version 2): one paragraph per line,
 * the text of each kept exactly; an empty line is an empty paragraph.
 */
export function notesFromPlainText(text: string): NotesDocument {
  return {
    type: 'doc',
    content: text
      .split(/\r?\n/)
      .map((line) =>
        line
          ? { type: 'paragraph', content: [{ type: 'text', text: line }] }
          : { type: 'paragraph' },
      ),
  };
}

/**
 * Notes from untrusted data, keeping only the fields of allowed nodes and marks; undefined when
 * anything is not allowed (a link, a table, a colour, a third heading level…), malformed, nested
 * deeper than MAX_NOTES_DEPTH or larger than MAX_NOTES_SIZE.
 */
export function parseNotes(value: unknown): NotesDocument | undefined {
  if (!isRecord(value) || value.type !== 'doc' || !fitsSize(value)) return undefined;
  const content = parseBlocks(value.content, 1, false);
  return content && { type: 'doc', content };
}

function fitsSize(value: unknown): boolean {
  try {
    return JSON.stringify(value).length <= MAX_NOTES_SIZE;
  } catch {
    return false;
  }
}

/** At least one block node; with `paragraphFirst`, the first one a paragraph. */
function parseBlocks(
  value: unknown,
  depth: number,
  paragraphFirst: boolean,
): NotesNode[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const nodes = value.map((item: unknown) => parseNode(item, BLOCK_NODES, depth));
  if (nodes.some((node) => node === undefined)) return undefined;
  if (paragraphFirst && nodes[0]?.type !== 'paragraph') return undefined;
  return nodes as NotesNode[];
}

function parseNode(
  value: unknown,
  rules: Readonly<Record<string, NodeRule>>,
  depth: number,
): NotesNode | undefined {
  if (depth > MAX_NOTES_DEPTH || !isRecord(value) || typeof value.type !== 'string') {
    return undefined;
  }
  const { type } = value;
  const rule = Object.hasOwn(rules, type) ? rules[type] : undefined;
  if (!rule) return undefined;

  let attrs: Attrs | undefined;
  if (rule.attrs) {
    attrs = rule.attrs(isRecord(value.attrs) ? value.attrs : {});
    if (!attrs) return undefined;
  }
  const withAttrs = attrs ? { type, attrs } : { type };

  if (rule.content === 'none') return value.content === undefined ? withAttrs : undefined;
  if (rule.content === 'inline') {
    if (value.content === undefined) return withAttrs;
    const content = parseInline(value.content);
    if (!content) return undefined;
    return content.length > 0 ? { ...withAttrs, content } : withAttrs;
  }
  if (rule.content === 'blocks') {
    const content = parseBlocks(value.content, depth + 1, rule.paragraphFirst ?? false);
    return content && { ...withAttrs, content };
  }
  const itemRules = rule.content.items;
  if (!Array.isArray(value.content) || value.content.length === 0) return undefined;
  const items = value.content.map((item: unknown) => parseNode(item, itemRules, depth + 1));
  if (items.some((item) => item === undefined)) return undefined;
  return { ...withAttrs, content: items as NotesNode[] };
}

/** Text nodes, each with some text and only allowed marks, each mark once. */
function parseInline(value: unknown): NotesNode[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const nodes: NotesNode[] = [];
  for (const item of value) {
    if (!isRecord(item) || item.type !== 'text') return undefined;
    if (typeof item.text !== 'string' || item.text === '') return undefined;
    const marks = item.marks === undefined ? [] : parseMarks(item.marks);
    if (!marks) return undefined;
    nodes.push(
      marks.length > 0
        ? { type: 'text', text: item.text, marks }
        : { type: 'text', text: item.text },
    );
  }
  return nodes;
}

function parseMarks(value: unknown): NotesMark[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const marks: NotesMark[] = [];
  for (const item of value) {
    if (!isRecord(item)) return undefined;
    const mark = MARKS.find((type) => type === item.type);
    if (!mark || marks.some((known) => known.type === mark)) return undefined;
    marks.push({ type: mark });
  }
  return marks;
}

// Media uses -----------------------------------------------------------------

/** Every Media the images of the Notes show, in document order: Notes images are Media uses. */
export function mediaOfNotes(notes: NotesDocument): string[] {
  const found: string[] = [];
  const visit = (nodes: readonly NotesNode[] | undefined) => {
    for (const node of nodes ?? []) {
      const mediaId = node.attrs?.mediaId;
      if (node.type === 'image' && typeof mediaId === 'string') found.push(mediaId);
      visit(node.content);
    }
  };
  visit(notes.content);
  return found;
}

/**
 * The Notes with only the images whose Media `keep` accepts, the rest as they were: a deleted
 * Media leaves no image pointing at nothing. A quote, or the Notes themselves, left with no block
 * gets one empty paragraph, as the editor would (list items always start with a paragraph, so
 * they never empty). The same Notes object when every image is kept.
 */
export function notesKeepingImages(
  notes: NotesDocument,
  keep: (mediaId: string) => boolean,
): NotesDocument {
  if (mediaOfNotes(notes).every(keep)) return notes;
  const kept = (node: NotesNode) => {
    const mediaId = node.attrs?.mediaId;
    return node.type !== 'image' || (typeof mediaId === 'string' && keep(mediaId));
  };
  const clean = (nodes: readonly NotesNode[]): NotesNode[] => {
    const left = nodes
      .filter(kept)
      .map((node) => (node.content ? { ...node, content: clean(node.content) } : node));
    return left.length > 0 ? left : [{ type: 'paragraph' }];
  };
  return { type: 'doc', content: clean(notes.content) };
}
