import { Extension } from '@tiptap/core';
import { Plugin, type Transaction } from '@tiptap/pm/state';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { MAX_NOTES_DEPTH } from '../core/notes';
import { showNotice } from './notices';

/** What the Game Master is told when a change would nest the Notes too deep. */
export const TOO_DEEP_NOTICE = 'Les notes ne peuvent pas être imbriquées plus profondément.';

/** How many levels of nodes (text aside) stand below `node`. */
function levelsBelow(node: ProseMirrorNode): number {
  let deepest = 0;
  node.forEach((child) => {
    if (!child.isText) deepest = Math.max(deepest, 1 + levelsBelow(child));
  });
  return deepest;
}

/**
 * Whether the document a transaction leaves nests deeper than MAX_NOTES_DEPTH, counted as
 * core/notes.ts counts it (the document's own blocks at depth 1). Only the parts the transaction
 * changed are looked at, from the deepest node holding each: typing stays cheap in long Notes.
 */
export function nestsTooDeep(tr: Transaction): boolean {
  const { doc, mapping } = tr;
  return mapping.maps.some((map, index) => {
    const after = mapping.slice(index + 1);
    let tooDeep = false;
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      const from = doc.resolve(Math.min(after.map(newStart, -1), doc.content.size));
      const to = Math.min(Math.max(after.map(newEnd, 1), from.pos), doc.content.size);
      const depth = from.sharedDepth(to);
      if (depth + levelsBelow(from.node(depth)) > MAX_NOTES_DEPTH) tooDeep = true;
    });
    return tooDeep;
  });
}

/**
 * Keeps the Notes editor from nesting quotes and lists deeper than the Notes may be stored
 * (MAX_NOTES_DEPTH, core/notes.ts): a change that would (a Tab in a list, a paste) is refused,
 * with a notice, instead of leaving Notes no save would take.
 * https://prosemirror.net/docs/ref/#state.PluginSpec.filterTransaction
 */
export const NotesDepthLimit = Extension.create({
  name: 'notesDepthLimit',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        filterTransaction: (tr) => {
          if (!tr.docChanged || !nestsTooDeep(tr)) return true;
          showNotice(TOO_DEEP_NOTICE);
          return false;
        },
      }),
    ];
  },
});
