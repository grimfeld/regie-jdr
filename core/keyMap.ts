/**
 * The Control window's key map: which key does what, the defaults, and the Game Master's
 * remapping (kept in the global Settings). No DOM, Node or Electron: the windows run it, and the
 * main process checks what a window asks to save with it.
 *
 * Every shortcut is a row of `SHORTCUT_ROWS`; a new row is listed on the shortcuts page and can
 * be remapped with no other code. One key never does two things: `keyMapOf` drops a key already
 * taken, and `assignKey` asks before taking a key from another shortcut ("Remplacer").
 */
import type {
  CutModifier,
  KeyChord,
  PadKeyPosition,
  Shortcut,
  ShortcutSettings,
} from '../shared/domain.js';
import { isRecord } from './guards.js';

export type { CutModifier, KeyChord, PadKeyPosition, Shortcut, ShortcutSettings };

/** The Soundboard pads a number key plays: the first nine, 1 is the first. */
export const PAD_KEY_POSITIONS: readonly PadKeyPosition[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];

interface ShortcutRow {
  /** What the shortcut does, in French, as the shortcuts page lists it. */
  readonly name: string;
  /** Its default keys; the first one is the one shown. */
  readonly keys: readonly KeyChord[];
  /** Fires again while its key is held; the others fire once per press. */
  readonly repeats?: true;
  /**
   * Activates: answers with or without the Cut modifier, which is not part of the key but asks
   * for a forced Cut (the handler reads it from the key press).
   */
  readonly takesCut?: true;
  /** Cannot be remapped: its keys are the text editing ones (undo, redo). */
  readonly fixed?: true;
}

function padRow(position: PadKeyPosition): ShortcutRow {
  return {
    name: `Jouer le pad ${position}`,
    keys: [{ code: `Digit${position}` }, { code: `Numpad${position}` }],
  };
}

/** Every shortcut, in the order a key press is looked up and the shortcuts page lists them. */
export const SHORTCUT_ROWS: Readonly<Record<Shortcut, ShortcutRow>> = {
  undo: {
    name: 'Annuler la dernière modification de la scène',
    keys: [{ key: 'z', ctrl: true }],
    repeats: true,
    fixed: true,
  },
  redo: {
    name: 'Rétablir la modification annulée',
    keys: [
      { key: 'y', ctrl: true },
      { key: 'z', ctrl: true, shift: true },
    ],
    repeats: true,
    fixed: true,
  },
  activate: {
    name: 'Activer la scène sélectionnée',
    keys: [{ key: 'enter', ctrl: true }],
    takesCut: true,
  },
  'activate-next': {
    name: 'Activer la scène suivante',
    keys: [{ key: 'arrowdown', ctrl: true }],
    takesCut: true,
  },
  'activate-previous': {
    name: 'Activer la scène précédente',
    keys: [{ key: 'arrowup', ctrl: true }],
    takesCut: true,
  },
  'move-scene-up': {
    name: 'Monter la scène dans l’ordre',
    keys: [{ key: 'arrowup', alt: true }],
    repeats: true,
  },
  'move-scene-down': {
    name: 'Descendre la scène dans l’ordre',
    keys: [{ key: 'arrowdown', alt: true }],
    repeats: true,
  },
  blackout: { name: 'Noir', keys: [{ key: 'b' }] },
  silence: { name: 'Silence', keys: [{ key: 's' }] },
  'pad-1': padRow(1),
  'pad-2': padRow(2),
  'pad-3': padRow(3),
  'pad-4': padRow(4),
  'pad-5': padRow(5),
  'pad-6': padRow(6),
  'pad-7': padRow(7),
  'pad-8': padRow(8),
  'pad-9': padRow(9),
};

/** Every shortcut, in `SHORTCUT_ROWS` order. */
export const SHORTCUTS = Object.keys(SHORTCUT_ROWS) as readonly Shortcut[];

/** The shortcuts the Game Master may remap: all but undo and redo. */
export const REMAPPABLE_SHORTCUTS: readonly Shortcut[] = SHORTCUTS.filter(
  (shortcut) => SHORTCUT_ROWS[shortcut].fixed !== true,
);

export function shortcutName(shortcut: Shortcut): string {
  return SHORTCUT_ROWS[shortcut].name;
}

export function isShortcut(value: unknown): value is Shortcut {
  return typeof value === 'string' && Object.hasOwn(SHORTCUT_ROWS, value);
}

/** Whether Activate shortcuts read `shortcut`'s key press for the Cut modifier. */
export function takesCut(shortcut: Shortcut): boolean {
  return SHORTCUT_ROWS[shortcut].takesCut === true;
}

/** The keys in force: each shortcut's keys, and the modifier that forces a Cut. */
export interface KeyMap {
  readonly keys: Readonly<Record<Shortcut, readonly KeyChord[]>>;
  readonly cutModifier: CutModifier;
}

export const CUT_MODIFIERS: readonly CutModifier[] = ['shift', 'alt', 'ctrl'];

/** Nothing remapped, Shift forces the Cut. */
export const DEFAULT_SHORTCUTS: ShortcutSettings = { keys: {}, cutModifier: 'shift' };

// Names --------------------------------------------------------------------

const MODIFIER_LABELS: Readonly<Record<CutModifier, string>> = {
  ctrl: 'Ctrl',
  shift: 'Maj',
  alt: 'Alt',
};

export function modifierLabel(modifier: CutModifier): string {
  return MODIFIER_LABELS[modifier];
}

/** French names of keys whose `key` value is not what is printed on them. */
const KEY_LABELS: Readonly<Record<string, string>> = {
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  enter: 'Entrée',
  ' ': 'Espace',
  home: 'Début',
  end: 'Fin',
  pageup: 'Page préc.',
  pagedown: 'Page suiv.',
  insert: 'Inser',
  delete: 'Suppr',
  backspace: 'Retour arrière',
  escape: 'Échap',
  tab: 'Tab',
  control: 'Ctrl',
  shift: 'Maj',
  alt: 'Alt',
  altgraph: 'Alt Gr',
  meta: 'Windows',
  capslock: 'Verr. maj',
  contextmenu: 'Menu',
};

/** ARIA (`aria-keyshortcuts`) names of keys whose name is not their character upper-cased. */
const ARIA_KEY_NAMES: Readonly<Record<string, string>> = {
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  enter: 'Enter',
  ' ': 'Space',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  insert: 'Insert',
  contextmenu: 'ContextMenu',
};

const NUMBER_KEY = /^(Digit|Numpad)([0-9])$/;

function capitalised(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function keyLabel(chord: KeyChord): string {
  const number = NUMBER_KEY.exec(chord.code ?? '');
  if (number) return number[1] === 'Numpad' ? `Pavé ${number[2]}` : number[2];
  const key = chord.key ?? chord.code ?? '';
  return KEY_LABELS[key] ?? capitalised(key);
}

/** How a key is shown to the Game Master: "Ctrl+Maj+Z", "Ctrl+Entrée", "1", "Pavé 1". */
export function chordLabel(chord: KeyChord): string {
  return [chord.ctrl && 'Ctrl', chord.shift && 'Maj', chord.alt && 'Alt', keyLabel(chord)]
    .filter(Boolean)
    .join('+');
}

/** A key in `aria-keyshortcuts` syntax: "Control+Enter", "B", "1". */
export function ariaChord(chord: KeyChord): string {
  const number = NUMBER_KEY.exec(chord.code ?? '');
  const key = chord.key ?? chord.code ?? '';
  const name = number ? number[2] : (ARIA_KEY_NAMES[key] ?? capitalised(key));
  return [chord.ctrl && 'Control', chord.shift && 'Shift', chord.alt && 'Alt', name]
    .filter(Boolean)
    .join('+');
}

/** How `shortcut`'s key is shown to the Game Master: its first key, if it has one. */
export function keyLabelOf(shortcut: Shortcut, keyMap: KeyMap = KEY_MAP): string | undefined {
  const first = keyMap.keys[shortcut].at(0);
  return first && chordLabel(first);
}

/** `shortcut`'s keys for `aria-keyshortcuts`, or undefined when it has none. */
export function ariaKeyShortcutsOf(
  shortcut: Shortcut,
  keyMap: KeyMap = KEY_MAP,
): string | undefined {
  const names = [...new Set(keyMap.keys[shortcut].map(ariaChord))];
  return names.length > 0 ? names.join(' ') : undefined;
}

// Key presses --------------------------------------------------------------

/** The key event fields a key is read from. */
export interface KeyPressFields {
  readonly key: string;
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

/** Whether `modifier` is held in `press` (a key press or a click). */
export function holds(
  press: Pick<KeyPressFields, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
  modifier: CutModifier,
): boolean {
  switch (modifier) {
    case 'ctrl':
      return press.ctrlKey || press.metaKey;
    case 'shift':
      return press.shiftKey;
    case 'alt':
      return press.altKey;
  }
}

/**
 * The key a press is: the number row and the numpad by position, anything else by the
 * character typed (so the letters follow the layout).
 */
export function chordOf(press: KeyPressFields): KeyChord {
  const chord: KeyChord = NUMBER_KEY.test(press.code)
    ? { code: press.code }
    : { key: press.key.toLowerCase() };
  if (holds(press, 'ctrl')) chord.ctrl = true;
  if (press.shiftKey) chord.shift = true;
  if (press.altKey) chord.alt = true;
  return chord;
}

function withModifier(chord: KeyChord, modifier: CutModifier): KeyChord {
  return { ...chord, [modifier]: true };
}

function matches(chord: KeyChord, press: KeyPressFields, ignored?: CutModifier): boolean {
  if (chord.code !== undefined && chord.code !== press.code) return false;
  if (chord.key !== undefined && chord.key !== press.key.toLowerCase()) return false;
  return CUT_MODIFIERS.every(
    (modifier) => modifier === ignored || (chord[modifier] ?? false) === holds(press, modifier),
  );
}

/** The shortcut a key press means in `keyMap`, if any. Auto-repeat counts only for some. */
export function shortcutPressed(
  press: KeyPressFields & { readonly repeat: boolean },
  keyMap: KeyMap,
): Shortcut | undefined {
  const shortcut = SHORTCUTS.find((candidate) =>
    keyMap.keys[candidate].some((chord) =>
      matches(chord, press, takesCut(candidate) ? keyMap.cutModifier : undefined),
    ),
  );
  if (shortcut === undefined) return undefined;
  if (press.repeat && SHORTCUT_ROWS[shortcut].repeats !== true) return undefined;
  return shortcut;
}

// Remapping ----------------------------------------------------------------

/** One identity per key, whatever field order or false modifiers it was written with. */
function chordId(chord: KeyChord): string {
  const modifiers = CUT_MODIFIERS.filter((modifier) => chord[modifier] === true).join('+');
  return `${modifiers}|${chord.code ?? ''}|${chord.key ?? ''}`;
}

/** The keys `chord` takes for `shortcut`: an Activate key with the Cut modifier too. */
function takenBy(shortcut: Shortcut, chord: KeyChord, cutModifier: CutModifier): string[] {
  const ids = [chordId(chord)];
  if (takesCut(shortcut)) ids.push(chordId(withModifier(chord, cutModifier)));
  return ids;
}

const BARE_MODIFIERS = new Set([
  'control',
  'shift',
  'alt',
  'altgraph',
  'meta',
  'os',
  'capslock',
  'numlock',
  'scrolllock',
  'fn',
]);
const UNUSABLE_KEYS = new Set(['', 'dead', 'unidentified', 'process', 'compose']);
/** Keys that edit text or press the focused button: never a shortcut. */
const EDITING_KEYS = new Set(['backspace', 'delete']);
/** Keys that do it without Ctrl or Alt only. */
const PLAIN_EDITING_KEYS = new Set(['enter', ' ']);
/** Ctrl+these select, copy, paste and cut. */
const CLIPBOARD_LETTERS = new Set(['a', 'c', 'v', 'x']);

/**
 * Why `chord` can never be `shortcut`'s key, in French, or undefined if it can: Escape, Tab,
 * F11, a modifier alone, the text editing keys (undo and redo's among them), and, for an
 * Activate shortcut, the Cut modifier.
 */
export function refusalOf(
  shortcut: Shortcut,
  chord: KeyChord,
  cutModifier: CutModifier,
): string | undefined {
  const key = chord.key ?? '';
  const label = chordLabel(chord);
  if (chord.code === undefined) {
    if (BARE_MODIFIERS.has(key)) {
      return 'Une touche de modification seule (Ctrl, Maj, Alt…) ne peut pas servir de raccourci.';
    }
    if (UNUSABLE_KEYS.has(key)) return 'Cette touche ne peut pas servir de raccourci.';
    if (key === 'escape') return 'Échap est réservée : elle annule et quitte le plein écran.';
    if (key === 'tab') return 'Tab est réservée : elle passe d’un contrôle à l’autre.';
    if (key === 'f11') return 'F11 est réservée au plein écran.';
    const plain = chord.ctrl !== true && chord.alt !== true;
    if (
      EDITING_KEYS.has(key) ||
      (plain && PLAIN_EDITING_KEYS.has(key)) ||
      (chord.ctrl === true && chord.alt !== true && CLIPBOARD_LETTERS.has(key))
    ) {
      return `${label} est réservée à la saisie de texte.`;
    }
  }
  const ids = takenBy(shortcut, chord, cutModifier);
  const fixed = SHORTCUTS.find(
    (other) =>
      other !== shortcut &&
      SHORTCUT_ROWS[other].fixed === true &&
      SHORTCUT_ROWS[other].keys.some((taken) => ids.includes(chordId(taken))),
  );
  if (fixed) return `${label} est réservée : ${shortcutName(fixed)}.`;
  if (takesCut(shortcut) && chord[cutModifier] === true) {
    return `${modifierLabel(cutModifier)} force le Cut : elle ne peut pas faire partie d’une touche d’activation.`;
  }
  return undefined;
}

/**
 * The keys in force for `settings`: each remapped shortcut's keys, the defaults for the others.
 * A key refused, or already taken by a shortcut earlier in the map (the fixed ones first, then
 * the remapped ones), is dropped: one key never does two things, whatever the file holds.
 */
export function keyMapOf(settings: ShortcutSettings): KeyMap {
  const { cutModifier } = settings;
  const taken = new Set<string>();
  const keys = new Map<Shortcut, KeyChord[]>();
  const claim = (shortcut: Shortcut, chords: readonly KeyChord[]) => {
    const kept: KeyChord[] = [];
    for (const chord of chords) {
      const ids = takenBy(shortcut, chord, cutModifier);
      if (refusalOf(shortcut, chord, cutModifier) !== undefined) continue;
      if (ids.some((id) => taken.has(id))) continue;
      ids.forEach((id) => taken.add(id));
      kept.push(chord);
    }
    keys.set(shortcut, kept);
  };
  for (const shortcut of SHORTCUTS) {
    if (SHORTCUT_ROWS[shortcut].fixed) claim(shortcut, SHORTCUT_ROWS[shortcut].keys);
  }
  for (const shortcut of REMAPPABLE_SHORTCUTS) {
    const remapped = settings.keys[shortcut];
    if (remapped) claim(shortcut, remapped);
  }
  for (const shortcut of REMAPPABLE_SHORTCUTS) {
    if (!settings.keys[shortcut]) claim(shortcut, SHORTCUT_ROWS[shortcut].keys);
  }
  return {
    keys: Object.fromEntries(
      SHORTCUTS.map((shortcut) => [shortcut, keys.get(shortcut) ?? []]),
    ) as Record<Shortcut, KeyChord[]>,
    cutModifier,
  };
}

/** The default keys. */
export const KEY_MAP: KeyMap = keyMapOf(DEFAULT_SHORTCUTS);

/** A remapping done, refused, or waiting for "Remplacer" because the key is taken. */
export type Remapping =
  | { readonly outcome: 'remapped'; readonly settings: ShortcutSettings }
  | { readonly outcome: 'refused'; readonly reason: string }
  | { readonly outcome: 'taken'; readonly holders: readonly Shortcut[] };

/** The shortcuts other than `shortcut` that hold any of `ids` in `keyMap`. */
function holdersOf(keyMap: KeyMap, shortcut: Shortcut, ids: readonly string[]): Shortcut[] {
  return SHORTCUTS.filter(
    (other) =>
      other !== shortcut &&
      keyMap.keys[other].some((chord) =>
        takenBy(other, chord, keyMap.cutModifier).some((id) => ids.includes(id)),
      ),
  );
}

/** `holders`' keys with every one taking any of `ids` removed. */
function unbind(
  settings: ShortcutSettings,
  keyMap: KeyMap,
  holders: readonly Shortcut[],
  ids: readonly string[],
): ShortcutSettings['keys'] {
  const keys = { ...settings.keys };
  for (const holder of holders) {
    keys[holder] = keyMap.keys[holder].filter(
      (chord) => !takenBy(holder, chord, keyMap.cutModifier).some((id) => ids.includes(id)),
    );
  }
  return keys;
}

/**
 * Makes `chord` `shortcut`'s only key. A key another shortcut holds is `taken`, naming it,
 * unless `replace` (the Game Master chose "Remplacer"): that shortcut then loses that key.
 */
export function assignKey(
  settings: ShortcutSettings,
  shortcut: Shortcut,
  chord: KeyChord,
  replace = false,
): Remapping {
  if (SHORTCUT_ROWS[shortcut].fixed) {
    return { outcome: 'refused', reason: 'Ce raccourci ne peut pas être changé.' };
  }
  const reason = refusalOf(shortcut, chord, settings.cutModifier);
  if (reason !== undefined) return { outcome: 'refused', reason };
  const keyMap = keyMapOf(settings);
  const ids = takenBy(shortcut, chord, settings.cutModifier);
  const holders = holdersOf(keyMap, shortcut, ids);
  if (holders.length > 0 && !replace) return { outcome: 'taken', holders };
  const keys = unbind(settings, keyMap, holders, ids);
  keys[shortcut] = [chord];
  return { outcome: 'remapped', settings: { ...settings, keys } };
}

/** Leaves `shortcut` with no key. */
export function unbindShortcut(settings: ShortcutSettings, shortcut: Shortcut): ShortcutSettings {
  if (SHORTCUT_ROWS[shortcut].fixed) return settings;
  return { ...settings, keys: { ...settings.keys, [shortcut]: [] } };
}

/**
 * Makes `modifier` the one that forces a Cut. Refused if an Activate key holds it already; a
 * key another shortcut holds with an Activate key is `taken`, unless `replace`.
 */
export function assignCutModifier(
  settings: ShortcutSettings,
  modifier: CutModifier,
  replace = false,
): Remapping {
  const keyMap = keyMapOf(settings);
  const activates = SHORTCUTS.filter(takesCut);
  const holding = activates.find((shortcut) =>
    keyMap.keys[shortcut].some((chord) => chord[modifier] === true),
  );
  if (holding) {
    return {
      outcome: 'refused',
      reason: `${modifierLabel(modifier)} fait déjà partie de la touche « ${shortcutName(holding)} » : changez d’abord cette touche.`,
    };
  }
  const ids = activates.flatMap((shortcut) =>
    keyMap.keys[shortcut].map((chord) => chordId(withModifier(chord, modifier))),
  );
  const holders = SHORTCUTS.filter(
    (other) => !takesCut(other) && keyMap.keys[other].some((chord) => ids.includes(chordId(chord))),
  );
  const fixed = holders.find((holder) => SHORTCUT_ROWS[holder].fixed);
  if (fixed) {
    return {
      outcome: 'refused',
      reason: `Avec ${modifierLabel(modifier)}, une touche d’activation deviendrait « ${shortcutName(fixed)} ».`,
    };
  }
  if (holders.length > 0 && !replace) return { outcome: 'taken', holders };
  const keys = unbind(settings, keyMap, holders, ids);
  return { outcome: 'remapped', settings: { keys, cutModifier: modifier } };
}

/** Whether every key `settings` remaps is in force: none refused, none taken twice. */
export function isConsistent(settings: ShortcutSettings): boolean {
  const keyMap = keyMapOf(settings);
  return REMAPPABLE_SHORTCUTS.every((shortcut) => {
    const remapped = settings.keys[shortcut];
    return remapped === undefined || remapped.length === keyMap.keys[shortcut].length;
  });
}

// Stored settings ----------------------------------------------------------

const MAX_KEY_LENGTH = 32;

/** A key as stored or sent by a window, or undefined if it is not one. */
export function parseChord(value: unknown): KeyChord | undefined {
  if (!isRecord(value)) return undefined;
  const { code, key, ctrl, shift, alt } = value;
  const chord: KeyChord = {};
  if (typeof code === 'string' && key === undefined) {
    if (!NUMBER_KEY.test(code)) return undefined;
    chord.code = code;
  } else if (typeof key === 'string' && code === undefined) {
    if (key === '' || key.length > MAX_KEY_LENGTH || key !== key.toLowerCase()) return undefined;
    chord.key = key;
  } else {
    return undefined;
  }
  for (const [modifier, held] of [
    ['ctrl', ctrl],
    ['shift', shift],
    ['alt', alt],
  ] as const) {
    if (held === true) chord[modifier] = true;
    else if (held !== undefined && held !== false) return undefined;
  }
  return chord;
}

function isCutModifier(value: unknown): value is CutModifier {
  return CUT_MODIFIERS.some((modifier) => modifier === value);
}

/**
 * The shortcut keys stored in Settings, keeping what can be read: an unknown shortcut, an
 * unreadable key or modifier is dropped (its default is used).
 */
export function parseShortcutSettings(value: unknown): ShortcutSettings {
  if (!isRecord(value)) return DEFAULT_SHORTCUTS;
  const keys: ShortcutSettings['keys'] = {};
  if (isRecord(value.keys)) {
    for (const shortcut of REMAPPABLE_SHORTCUTS) {
      const chords = value.keys[shortcut];
      if (!Array.isArray(chords)) continue;
      keys[shortcut] = chords
        .map(parseChord)
        .filter((chord): chord is KeyChord => chord !== undefined);
    }
  }
  return {
    keys,
    cutModifier: isCutModifier(value.cutModifier) ? value.cutModifier : 'shift',
  };
}

/**
 * The shortcut keys a window asks to save, or undefined unless every part is readable: a
 * window never sends half a key map.
 */
export function shortcutSettingsOf(value: unknown): ShortcutSettings | undefined {
  if (!isRecord(value) || !isRecord(value.keys) || !isCutModifier(value.cutModifier)) {
    return undefined;
  }
  const keys: ShortcutSettings['keys'] = {};
  for (const [shortcut, chords] of Object.entries(value.keys)) {
    if (!isShortcut(shortcut) || SHORTCUT_ROWS[shortcut].fixed || !Array.isArray(chords)) {
      return undefined;
    }
    const parsed = chords.map(parseChord);
    if (!parsed.every((chord): chord is KeyChord => chord !== undefined)) return undefined;
    keys[shortcut] = parsed;
  }
  return { keys, cutModifier: value.cutModifier };
}
