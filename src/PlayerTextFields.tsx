import { useState, type KeyboardEvent } from 'react';
import { Eye, EyeOff, Tag } from 'lucide-react';
import type { SceneEdit } from '../shared/contract';
import type { Overlay } from '../shared/domain';
import { MAX_LABEL_LENGTH, MAX_SCENE_TITLE_LENGTH } from '../core/sceneEdits';

/**
 * A text field that sends its text when the Game Master is done with it (Enter or leaving the
 * field), not on every key. Escape puts back the saved text. Follows `value` when it changes.
 */
function CommittedText(props: {
  value: string;
  label: string;
  placeholder: string;
  maxLength: number;
  onCommit: (text: string) => void;
}) {
  const { value, label, placeholder, maxLength, onCommit } = props;
  const [draft, setDraft] = useState(value);
  const [saved, setSaved] = useState(value);
  if (saved !== value) {
    setSaved(value);
    setDraft(value);
  }

  function commit() {
    if (draft !== value) onCommit(draft);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // Leaving the field sends the text, once.
    if (event.key === 'Enter') event.currentTarget.blur();
    if (event.key === 'Escape') setDraft(value);
  }

  return (
    <input
      aria-label={label}
      placeholder={placeholder}
      maxLength={maxLength}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
    />
  );
}

/**
 * An Overlay's Label: its text and its own show/hide, independent of the Overlay's. A new
 * Label starts Hidden; it can be shown once it has text.
 */
export function LabelControls(props: {
  overlay: Overlay;
  /** The Overlay's Media name, to name the controls. */
  name: string;
  onEdit: (command: SceneEdit) => void;
}) {
  const { overlay, name, onEdit } = props;
  const { id: overlayId, label } = overlay;
  const shown = label?.visible ?? false;
  return (
    <div className={`placement-label${label && !shown ? ' is-hidden' : ''}`}>
      <Tag size={13} aria-hidden />
      <CommittedText
        label={`Étiquette de ${name}`}
        placeholder="Étiquette"
        maxLength={MAX_LABEL_LENGTH}
        value={label?.text ?? ''}
        onCommit={(text) => onEdit({ kind: 'set-label-text', overlayId, text })}
      />
      <label className="placement-visible">
        <input
          type="checkbox"
          aria-label={`Afficher l’étiquette de ${name}`}
          checked={shown}
          disabled={!label}
          onChange={(e) =>
            onEdit({ kind: 'set-label-visible', overlayId, visible: e.target.checked })
          }
        />
        {shown ? <Eye size={14} aria-hidden /> : <EyeOff size={14} aria-hidden />}
        {label && !shown && <small>Masquée</small>}
      </label>
    </div>
  );
}

/**
 * The Scene title players see, discreetly, on the broadcast; empty shows nothing. Separate
 * from the Scene's name, which stays private.
 */
export function SceneTitleField(props: { title: string; onEdit: (command: SceneEdit) => void }) {
  const { title, onEdit } = props;
  return (
    <label className="scene-title-field">
      TITRE AFFICHÉ
      <CommittedText
        label="Titre affiché"
        placeholder="Aucun titre à l’antenne"
        maxLength={MAX_SCENE_TITLE_LENGTH}
        value={title}
        onCommit={(text) => onEdit({ kind: 'set-title', title: text })}
      />
    </label>
  );
}
