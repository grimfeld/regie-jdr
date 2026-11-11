import { useEffect, useRef } from 'react';
import { EditorContent, useEditor, useEditorState, type JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import {
  Bold,
  Heading1,
  Heading2,
  Italic,
  List,
  ListChecks,
  ListOrdered,
  NotebookPen,
  Quote,
  Redo2,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import type { NotesDocument } from '../shared/domain';
import { MAX_NOTES_SIZE, parseNotes } from '../core/notes';
import { showNotice } from './notices';

/** How long after the last change the Notes are saved. Leaving the editor saves at once. */
export const NOTES_SAVE_DELAY_MS = 500;

/**
 * The Notes editor's content: exactly what core/notes.ts allows, nothing else. ProseMirror
 * keeps only content its schema knows, so a paste of links, tables, colours or images keeps
 * just their text in allowed blocks. Images in Notes (#52) add a node here and in core/notes.ts.
 *
 * StarterKit v3 options: https://tiptap.dev/docs/editor/extensions/functionality/starterkit
 * Task lists: https://tiptap.dev/docs/editor/extensions/nodes/task-list
 */
const EXTENSIONS = [
  StarterKit.configure({
    heading: { levels: [1, 2] },
    code: false,
    codeBlock: false,
    strike: false,
    underline: false,
    link: false,
    horizontalRule: false,
    hardBreak: false,
  }),
  TaskList,
  TaskItem.configure({
    nested: true,
    a11y: {
      checkboxLabel: (node) => `Case à cocher : ${node.textContent || 'vide'}`,
    },
  }),
];

/**
 * The Selected Scene's Notes, shown in the control column beside the editor: rich text private to
 * the Game Master, never on air. Saved as the Game Master types (NOTES_SAVE_DELAY_MS after the
 * last change), when the editor loses focus and when it closes (another Scene opened).
 *
 * Undo: the editor keeps its own history (Ctrl+Z and Ctrl+Y while typing in it, or its buttons),
 * separate from the Scene undo history, which Notes never enter (core/undoHistory.ts). Typing
 * groups into undo steps as the editor's history does (a pause starts a new step).
 *
 * The editor owns its text once open: a saved Scene coming back does not reset it.
 */
export function SceneNotes(props: {
  /** The Selected Scene's name, shown in the heading. */
  sceneName: string;
  notes: NotesDocument;
  /** Saves the Notes (a `set-notes` Scene edit); a failure is shown as a notice. */
  onSave: (notes: NotesDocument) => void;
}) {
  const onSave = useRef(props.onSave);
  useEffect(() => {
    onSave.current = props.onSave;
  });
  /** The editor's content not saved yet, read at the change (the editor may be gone at flush). */
  const pending = useRef<{ json: JSONContent; timer: number } | undefined>(undefined);

  /** Saves the change still waiting, if any. */
  function flush() {
    const waiting = pending.current;
    if (!waiting) return;
    window.clearTimeout(waiting.timer);
    pending.current = undefined;
    const { json } = waiting;
    const notes = parseNotes(json);
    if (notes) onSave.current(notes);
    else if (JSON.stringify(json).length > MAX_NOTES_SIZE) {
      showNotice('Les notes sont trop longues pour être enregistrées.');
    } else showNotice('Ces notes contiennent un contenu non pris en charge.');
  }
  const latestFlush = useRef(flush);
  useEffect(() => {
    latestFlush.current = flush;
  });

  const editor = useEditor({
    extensions: EXTENSIONS,
    content: props.notes,
    // The window's Content Security Policy refuses injected <style> elements: the editor's base
    // styles are in styles.css instead.
    injectCSS: false,
    editorProps: {
      attributes: { role: 'textbox', 'aria-label': 'Notes de la scène', 'aria-multiline': 'true' },
    },
    onUpdate: ({ editor: changed }) => {
      if (pending.current) window.clearTimeout(pending.current.timer);
      pending.current = {
        json: changed.getJSON(),
        timer: window.setTimeout(() => latestFlush.current(), NOTES_SAVE_DELAY_MS),
      };
    },
    onBlur: () => latestFlush.current(),
  });
  // Closing the editor (another Scene opened) saves what is still waiting.
  useEffect(() => () => latestFlush.current(), []);

  // Toolbar state: https://tiptap.dev/docs/guides/performance (useEditorState)
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      heading1: current.isActive('heading', { level: 1 }),
      heading2: current.isActive('heading', { level: 2 }),
      bold: current.isActive('bold'),
      italic: current.isActive('italic'),
      bulletList: current.isActive('bulletList'),
      orderedList: current.isActive('orderedList'),
      taskList: current.isActive('taskList'),
      blockquote: current.isActive('blockquote'),
      canUndo: current.can().undo(),
      canRedo: current.can().redo(),
    }),
  });
  const chain = () => editor.chain().focus();

  return (
    <section className="panel scene-notes" aria-label="Notes">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">PRIVÉES, JAMAIS DIFFUSÉES</span>
          <h2>
            <NotebookPen size={18} aria-hidden /> Notes
          </h2>
          <span className="scene-notes-scene">{props.sceneName}</span>
        </div>
      </div>
      <div className="scene-notes-toolbar" role="toolbar" aria-label="Mise en forme des notes">
        <FormatButton
          icon={Heading1}
          label="Titre"
          on={state.heading1}
          onClick={() => chain().toggleHeading({ level: 1 }).run()}
        />
        <FormatButton
          icon={Heading2}
          label="Sous-titre"
          on={state.heading2}
          onClick={() => chain().toggleHeading({ level: 2 }).run()}
        />
        <FormatButton
          icon={Bold}
          label="Gras"
          on={state.bold}
          onClick={() => chain().toggleBold().run()}
        />
        <FormatButton
          icon={Italic}
          label="Italique"
          on={state.italic}
          onClick={() => chain().toggleItalic().run()}
        />
        <FormatButton
          icon={List}
          label="Liste à puces"
          on={state.bulletList}
          onClick={() => chain().toggleBulletList().run()}
        />
        <FormatButton
          icon={ListOrdered}
          label="Liste numérotée"
          on={state.orderedList}
          onClick={() => chain().toggleOrderedList().run()}
        />
        <FormatButton
          icon={ListChecks}
          label="Liste de cases à cocher"
          on={state.taskList}
          onClick={() => chain().toggleTaskList().run()}
        />
        <FormatButton
          icon={Quote}
          label="Citation"
          on={state.blockquote}
          onClick={() => chain().toggleBlockquote().run()}
        />
        <button
          className="icon-button"
          aria-label="Annuler dans les notes"
          title="Annuler dans les notes (Ctrl+Z)"
          disabled={!state.canUndo}
          onClick={() => chain().undo().run()}
        >
          <Undo2 size={14} aria-hidden />
        </button>
        <button
          className="icon-button"
          aria-label="Rétablir dans les notes"
          title="Rétablir dans les notes (Ctrl+Y)"
          disabled={!state.canRedo}
          onClick={() => chain().redo().run()}
        >
          <Redo2 size={14} aria-hidden />
        </button>
      </div>
      <EditorContent editor={editor} className="scene-notes-editor" />
    </section>
  );
}

function FormatButton(props: {
  icon: LucideIcon;
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  const { icon: Icon, label, on, onClick } = props;
  return (
    <button
      className="icon-button"
      aria-label={label}
      title={label}
      aria-pressed={on}
      // Keeps the selection in the text while the button is clicked.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      <Icon size={14} aria-hidden />
    </button>
  );
}
