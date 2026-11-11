import { useEffect, useRef } from 'react';

/**
 * Keyboard shortcuts of the Control window. A shortcut never fires while the Game Master is
 * typing in a field: there the keys keep their text meaning (Ctrl+Z undoes typing), and never
 * in another window (only the focused window gets key presses).
 *
 * Every shortcut is a row of `KEY_MAP`, read by `shortcutOf`; components react to them through
 * `useShortcuts`. A new shortcut is a new `Shortcut` and a new row; remapping (M4 #71) replaces
 * the rows of the remappable shortcuts.
 */

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

/** The Soundboard pads a number key plays: the first nine, 1 is the first. */
export const PAD_KEY_POSITIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
export type PadKeyPosition = (typeof PAD_KEY_POSITIONS)[number];

/** The Scene edit shortcuts: Ctrl+Z undoes, Ctrl+Y or Ctrl+Shift+Z redoes. */
export type EditShortcut = 'undo' | 'redo';

/**
 * The Activate shortcuts: Activate the Selected Scene, or the Scene after or before the Active
 * Scene in the running order. Shift held as well forces a Cut, this once.
 */
export type ActivateShortcut = 'activate' | 'activate-next' | 'activate-previous';

/** Everything a key can do in the Control window. */
export type Shortcut =
  EditShortcut | ActivateShortcut | 'blackout' | 'silence' | `pad-${PadKeyPosition}`;

/**
 * One key press a shortcut answers to. `code` names a physical key, whatever the layout (the
 * number row gives "&é\"'…" on a French keyboard, still Digit1…); `key` names the character
 * typed, for a letter as printed on the key (Ctrl+Z on AZERTY). Modifiers must match exactly;
 * Ctrl also stands for Cmd.
 */
export interface KeyBinding {
  readonly code?: string;
  readonly key?: string;
  readonly ctrl?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
  /** How the key is shown to the Game Master, on a button or pad. */
  readonly label: string;
}

/** The keys of each shortcut; the first one is the one shown. */
export type KeyMap = Readonly<Record<Shortcut, readonly KeyBinding[]>>;

/** Shortcuts that fire again while their key is held; the others fire once per press. */
const REPEATING: ReadonlySet<Shortcut> = new Set<Shortcut>(['undo', 'redo']);

/**
 * Shortcuts whose keys answer with or without Shift, whatever their bindings say: Shift is not
 * part of the key but asks for a forced Cut, which the handler reads from the key press.
 */
const SHIFT_FREE: ReadonlySet<Shortcut> = new Set<Shortcut>([
  'activate',
  'activate-next',
  'activate-previous',
]);

function padBindings(position: PadKeyPosition): readonly KeyBinding[] {
  const label = String(position);
  return [
    { code: `Digit${position}`, label },
    { code: `Numpad${position}`, label },
  ];
}

/** The Control window's keys. */
export const KEY_MAP: KeyMap = {
  undo: [{ key: 'z', ctrl: true, label: 'Ctrl+Z' }],
  redo: [
    { key: 'y', ctrl: true, label: 'Ctrl+Y' },
    { key: 'z', ctrl: true, shift: true, label: 'Ctrl+Maj+Z' },
  ],
  activate: [{ key: 'enter', ctrl: true, label: 'Ctrl+Entrée' }],
  'activate-next': [{ key: 'arrowdown', ctrl: true, label: 'Ctrl+↓' }],
  'activate-previous': [{ key: 'arrowup', ctrl: true, label: 'Ctrl+↑' }],
  blackout: [{ key: 'b', label: 'B' }],
  silence: [{ key: 's', label: 'S' }],
  'pad-1': padBindings(1),
  'pad-2': padBindings(2),
  'pad-3': padBindings(3),
  'pad-4': padBindings(4),
  'pad-5': padBindings(5),
  'pad-6': padBindings(6),
  'pad-7': padBindings(7),
  'pad-8': padBindings(8),
  'pad-9': padBindings(9),
};

/** The key event fields a shortcut is read from. */
export type KeyPress = Pick<
  KeyboardEvent,
  'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'repeat' | 'target'
>;

function matches(binding: KeyBinding, press: KeyPress, shiftFree: boolean): boolean {
  if (binding.code !== undefined && binding.code !== press.code) return false;
  if (binding.key !== undefined && binding.key !== press.key.toLowerCase()) return false;
  return (
    (binding.ctrl ?? false) === (press.ctrlKey || press.metaKey) &&
    (shiftFree || (binding.shift ?? false) === press.shiftKey) &&
    (binding.alt ?? false) === press.altKey
  );
}

/** Every shortcut, in the order a key press is looked up. */
const SHORTCUTS: readonly Shortcut[] = [
  'undo',
  'redo',
  'activate',
  'activate-next',
  'activate-previous',
  'blackout',
  'silence',
  ...PAD_KEY_POSITIONS.map((position) => `pad-${position}` as const),
];

/** The shortcut a key press means in `keyMap`, if any; none while typing in a field. */
export function shortcutOf(press: KeyPress, keyMap: KeyMap = KEY_MAP): Shortcut | undefined {
  if (isTypingIn(press.target)) return undefined;
  const shortcut = SHORTCUTS.find((candidate) =>
    keyMap[candidate].some((binding) => matches(binding, press, SHIFT_FREE.has(candidate))),
  );
  if (shortcut === undefined || (press.repeat && !REPEATING.has(shortcut))) return undefined;
  return shortcut;
}

/** How `shortcut`'s key is shown to the Game Master. */
export function keyLabelOf(shortcut: Shortcut, keyMap: KeyMap = KEY_MAP): string | undefined {
  return keyMap[shortcut][0]?.label;
}

/**
 * What to do for each shortcut a component answers, given the key press (an Activate shortcut
 * reads Shift from it); the others pass through.
 */
export type ShortcutHandlers = Partial<Record<Shortcut, (press: KeyPress) => void>>;

/**
 * Calls the handler of each shortcut pressed anywhere in the window (`shortcutOf`), and keeps
 * the key from doing anything else. The latest `handlers` are used; they need not be stable.
 */
export function useShortcuts(handlers: ShortcutHandlers) {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const shortcut = shortcutOf(event);
      const handler = shortcut && latest.current[shortcut];
      if (!handler) return;
      event.preventDefault();
      handler(event);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
