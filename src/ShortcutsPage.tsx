import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Keyboard, RotateCcw, X } from 'lucide-react';
import type { CutModifier, KeyChord, Shortcut, ShortcutSettings } from '../shared/domain';
import {
  assignCutModifier,
  assignKey,
  chordLabel,
  chordOf,
  CUT_MODIFIERS,
  DEFAULT_SHORTCUTS,
  keyMapOf,
  modifierLabel,
  REMAPPABLE_SHORTCUTS,
  SHORTCUTS,
  shortcutName,
  type Remapping,
} from '../core/keyMap';

/** Keys whose press alone starts a chord: the capture waits for the key that follows. */
const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'AltGraph', 'Meta']);

/** A change waiting for "Remplacer": it takes a key other shortcuts hold. */
interface Pending {
  readonly what: string;
  readonly holders: readonly Shortcut[];
  readonly apply: () => Remapping;
}

interface ShortcutsPageProps {
  shortcuts: ShortcutSettings;
  onChange: (shortcuts: ShortcutSettings) => void;
  onClose: () => void;
}

/**
 * The shortcuts page: every remappable shortcut with its keys, changed by pressing the new key,
 * the modifier that forces a Cut, and "Rétablir les raccourcis par défaut". A key another
 * shortcut holds names it and offers "Remplacer"; a reserved key is refused with the reason.
 * Shortcuts are paused while it is open (ShortcutsContext), so a key pressed here only remaps.
 */
export function ShortcutsPage({ shortcuts, onChange, onClose }: ShortcutsPageProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  const keyMap = keyMapOf(shortcuts);
  const [capturing, setCapturing] = useState<Shortcut | null>(null);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);

  /** Saves a remapping done; says why one is refused; asks before taking a key. */
  function settle(remapping: Remapping, what: string, apply: () => Remapping) {
    switch (remapping.outcome) {
      case 'remapped':
        setPending(null);
        setMessage('');
        onChange(remapping.settings);
        return;
      case 'refused':
        setPending(null);
        setMessage(remapping.reason);
        return;
      case 'taken':
        setMessage('');
        setPending({ what, holders: remapping.holders, apply });
        return;
    }
  }

  function assign(shortcut: Shortcut, chord: KeyChord) {
    setCapturing(null);
    settle(assignKey(shortcuts, shortcut, chord), chordLabel(chord), () =>
      assignKey(shortcuts, shortcut, chord, true),
    );
  }

  function captureKeyDown(shortcut: Shortcut, event: KeyboardEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      setCapturing(null);
      return;
    }
    if (MODIFIER_KEYS.has(event.key) || event.repeat) return;
    assign(shortcut, chordOf(event.nativeEvent));
  }

  /** A modifier pressed and released alone: refused, as a shortcut of its own. */
  function captureKeyUp(shortcut: Shortcut, event: KeyboardEvent<HTMLButtonElement>) {
    if (!MODIFIER_KEYS.has(event.key)) return;
    event.preventDefault();
    assign(shortcut, chordOf(event.nativeEvent));
  }

  function changeCutModifier(modifier: CutModifier) {
    setCapturing(null);
    settle(assignCutModifier(shortcuts, modifier), modifierLabel(modifier), () =>
      assignCutModifier(shortcuts, modifier, true),
    );
  }

  const fixed = SHORTCUTS.filter((shortcut) => !REMAPPABLE_SHORTCUTS.includes(shortcut));
  const keysOf = (shortcut: Shortcut) =>
    keyMap.keys[shortcut].map(chordLabel).join(' ou ') || 'Aucune touche';

  return (
    <dialog
      ref={dialog}
      className="shortcuts-page"
      aria-labelledby="shortcuts-title"
      onCancel={(event) => {
        // Escape while a key is awaited cancels that only (captureKeyDown).
        event.preventDefault();
        if (capturing === null) onClose();
      }}
    >
      <div className="panel-heading">
        <div>
          <span className="eyebrow">FENÊTRE DE RÉGIE</span>
          <h2 id="shortcuts-title">
            <Keyboard size={18} /> Raccourcis clavier
          </h2>
        </div>
        <button className="secondary-button" onClick={onClose}>
          <X size={14} /> Fermer
        </button>
      </div>
      <p className="shortcuts-footnote">
        Les raccourcis agissent quand la fenêtre de régie est active, jamais pendant la saisie d’un
        texte.
      </p>

      <table className="shortcuts-table">
        <tbody>
          {REMAPPABLE_SHORTCUTS.map((shortcut) => {
            const name = shortcutName(shortcut);
            const waiting = capturing === shortcut;
            return (
              <tr key={shortcut}>
                <th scope="row">{name}</th>
                <td>
                  <kbd>{keysOf(shortcut)}</kbd>
                </td>
                <td>
                  <button
                    className={waiting ? 'primary-button' : 'secondary-button'}
                    aria-label={`Changer la touche : ${name}`}
                    aria-pressed={waiting}
                    onClick={() => {
                      setPending(null);
                      setMessage('');
                      setCapturing(waiting ? null : shortcut);
                    }}
                    onKeyDown={(event) => {
                      if (waiting) captureKeyDown(shortcut, event);
                    }}
                    onKeyUp={(event) => {
                      if (waiting) captureKeyUp(shortcut, event);
                    }}
                    onBlur={() => {
                      if (waiting) setCapturing(null);
                    }}
                  >
                    {waiting ? 'Appuyez sur une touche… (Échap : annuler)' : 'Changer'}
                  </button>
                </td>
              </tr>
            );
          })}
          <tr>
            <th scope="row">
              <label htmlFor="cut-modifier">Forcer le Cut (avec une touche d’activation)</label>
            </th>
            <td colSpan={2}>
              <select
                id="cut-modifier"
                value={shortcuts.cutModifier}
                onChange={(event) => {
                  const modifier = CUT_MODIFIERS.find((m) => m === event.target.value);
                  if (modifier) changeCutModifier(modifier);
                }}
              >
                {CUT_MODIFIERS.map((modifier) => (
                  <option key={modifier} value={modifier}>
                    {modifierLabel(modifier)}
                  </option>
                ))}
              </select>
            </td>
          </tr>
          {fixed.map((shortcut) => (
            <tr key={shortcut}>
              <th scope="row">{shortcutName(shortcut)}</th>
              <td>
                <kbd>{keysOf(shortcut)}</kbd>
              </td>
              <td className="shortcuts-fixed">Réservé</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div role="status" className="shortcuts-message">
        {pending ? (
          <div className="shortcuts-conflict">
            <p>
              « {pending.what} » sert déjà à :{' '}
              {pending.holders.map((holder) => shortcutName(holder)).join(', ')}.
            </p>
            <button
              className="primary-button"
              onClick={() => settle(pending.apply(), pending.what, pending.apply)}
            >
              Remplacer
            </button>
            <button className="secondary-button" onClick={() => setPending(null)}>
              Annuler
            </button>
          </div>
        ) : (
          message && <p>{message}</p>
        )}
      </div>

      <button
        className="secondary-button"
        onClick={() => {
          setCapturing(null);
          setPending(null);
          setMessage('');
          onChange(DEFAULT_SHORTCUTS);
        }}
      >
        <RotateCcw size={14} /> Rétablir les raccourcis par défaut
      </button>
    </dialog>
  );
}
