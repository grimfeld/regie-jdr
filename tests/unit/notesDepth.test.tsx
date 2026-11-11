// @vitest-environment jsdom
import { Editor, type JSONContent } from '@tiptap/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_NOTES_DEPTH, parseNotes } from '../../core/notes';
import { NOTES_EXTENSIONS } from '../../src/SceneNotes';
import { TOO_DEEP_NOTICE } from '../../src/notesDepth';

const notices = vi.hoisted(() => [] as string[]);
vi.mock('../../src/notices', () => ({
  showNotice: (text: string) => notices.push(text),
}));

const item = (text: string, more: JSONContent[] = []): JSONContent => ({
  type: 'listItem',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }, ...more],
});

/**
 * `levels` bullet lists, each in the last item of the one before; the deepest holds two items,
 * the second ready to be sunk into the first. Its paragraphs stand at depth 2 * levels + 1.
 */
function nestedLists(levels: number): JSONContent {
  let list: JSONContent = { type: 'bulletList', content: [item('a'), item('b')] };
  for (let level = 1; level < levels; level++) {
    list = { type: 'bulletList', content: [item(`l${String(level)}`, [list])] };
  }
  return { type: 'doc', content: [list] };
}

/** An editor holding `content`, its cursor in the text `at` (the item to sink). */
function editorWith(content: JSONContent, at = 'b') {
  const editor = new Editor({ extensions: NOTES_EXTENSIONS, content });
  editor.state.doc.descendants((node, pos) => {
    if (node.text === at) editor.commands.setTextSelection(pos + 1);
  });
  return editor;
}

/** The most lists nested in each other the Notes may hold: paragraphs at MAX_NOTES_DEPTH - 1. */
const MOST_LEVELS = (MAX_NOTES_DEPTH - 2) / 2;

afterEach(() => {
  notices.length = 0;
});

describe('the Notes editor nesting limit', () => {
  it('refuses a Tab that would nest past what the Notes may be saved with, and says so', () => {
    const deepest = nestedLists(MOST_LEVELS);
    expect(parseNotes(deepest)).toBeDefined();
    const editor = editorWith(deepest);
    const before = editor.getJSON();

    // The command applies; the editor refuses the change it makes.
    editor.commands.sinkListItem('listItem');

    expect(editor.getJSON()).toEqual(before);
    expect(parseNotes(editor.getJSON())).toBeDefined();
    expect(notices).toEqual([TOO_DEEP_NOTICE]);
    editor.destroy();
  });

  it('lets a Tab nest down to the limit', () => {
    const editor = editorWith(nestedLists(MOST_LEVELS - 1));
    const before = editor.getJSON();

    editor.commands.sinkListItem('listItem');

    expect(editor.getJSON()).not.toEqual(before);
    expect(parseNotes(editor.getJSON())).toBeDefined();
    expect(notices).toEqual([]);
    editor.destroy();
  });

  it('refuses pasted content nested too deep', () => {
    const editor = editorWith({ type: 'doc', content: [{ type: 'paragraph' }] });
    const before = editor.getJSON();
    const tooDeep = nestedLists(MOST_LEVELS + 1).content ?? [];

    editor.commands.insertContent(tooDeep);

    expect(editor.getJSON()).toEqual(before);
    expect(notices).toEqual([TOO_DEEP_NOTICE]);
    editor.destroy();
  });
});
