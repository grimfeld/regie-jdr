import { createContext, useContext, useEffect, useRef } from 'react';
import {
  KEY_MAP,
  shortcutPressed,
  type KeyMap,
  type KeyPressFields,
  type Shortcut,
} from '../core/keyMap';

/**
 * Keyboard shortcuts of the Control window. A shortcut never fires while the Game Master is
 * typing in a field: there the keys keep their text meaning (Ctrl+Z undoes typing), and never
 * in another window (only the focused window gets key presses).
 *
 * Every shortcut is a row of the key map (`core/keyMap.ts`), remapped by the Game Master on the
 * shortcuts page; the keys in force reach components through `ShortcutsContext`, and
 * components react to them through `useShortcuts`.
 */

export {
  ariaKeyShortcutsOf,
  KEY_MAP,
  keyLabelOf,
  PAD_KEY_POSITIONS,
  type KeyMap,
  type Shortcut,
} from '../core/keyMap';

/** Input types that take no typed text: a shortcut may fire while one has focus. */
const NON_TEXT_INPUTS = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

/**
 * Whether `target` (a key event's target) is a place where the Game Master types text. Anything
 * inside editable content counts, the Notes editor's own buttons too (an image's resize handle):
 * its keys belong to the editor.
 */
export function isTypingIn(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.closest('[contenteditable]:not([contenteditable="false"])')) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(target.type);
  return false;
}

/** The Scene edit shortcuts: Ctrl+Z undoes, Ctrl+Y or Ctrl+Shift+Z redoes. */
export type EditShortcut = Extract<Shortcut, 'undo' | 'redo'>;

/** The key event fields a shortcut is read from. */
export type KeyPress = KeyPressFields & Pick<KeyboardEvent, 'repeat' | 'target'>;

/** The shortcut a key press means in `keyMap`, if any; none while typing in a field. */
export function shortcutOf(press: KeyPress, keyMap: KeyMap = KEY_MAP): Shortcut | undefined {
  if (isTypingIn(press.target)) return undefined;
  return shortcutPressed(press, keyMap);
}

/** The keys in force in the Control window, and whether shortcuts are paused (being remapped). */
export interface ShortcutsInForce {
  readonly keyMap: KeyMap;
  readonly paused: boolean;
}

export const ShortcutsContext = createContext<ShortcutsInForce>({
  keyMap: KEY_MAP,
  paused: false,
});

/** The keys in force: the Game Master's remapping, or the defaults until it is read. */
export function useKeyMap(): KeyMap {
  return useContext(ShortcutsContext).keyMap;
}

/**
 * What to do for each shortcut a component answers, given the key press (an Activate shortcut
 * reads the Cut modifier from it); the others pass through.
 */
export type ShortcutHandlers = Partial<Record<Shortcut, (press: KeyPress) => void>>;

/**
 * Calls the handler of each shortcut pressed anywhere in the window (`shortcutOf`), and keeps
 * the key from doing anything else. The latest `handlers` are used; they need not be stable.
 */
export function useShortcuts(handlers: ShortcutHandlers) {
  const inForce = useContext(ShortcutsContext);
  const latest = useRef({ handlers, inForce });
  useEffect(() => {
    latest.current = { handlers, inForce };
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const { keyMap, paused } = latest.current.inForce;
      if (paused) return;
      const shortcut = shortcutOf(event, keyMap);
      const handler = shortcut && latest.current.handlers[shortcut];
      if (!handler) return;
      event.preventDefault();
      handler(event);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
