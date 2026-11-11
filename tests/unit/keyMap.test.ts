import { describe, expect, it } from 'vitest';
import {
  ariaKeyShortcutsOf,
  assignCutModifier,
  assignKey,
  chordLabel,
  chordOf,
  DEFAULT_SHORTCUTS,
  isConsistent,
  KEY_MAP,
  keyLabelOf,
  keyMapOf,
  parseShortcutSettings,
  REMAPPABLE_SHORTCUTS,
  SHORTCUT_ROWS,
  shortcutPressed,
  shortcutSettingsOf,
  unbindShortcut,
  type KeyChord,
  type Remapping,
  type ShortcutSettings,
} from '../../core/keyMap';

/** A key press, with no modifier unless given. */
function press(
  key: string,
  code: string,
  keys: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean; repeat?: boolean } = {},
) {
  return {
    key,
    code,
    ctrlKey: keys.ctrl ?? false,
    metaKey: keys.meta ?? false,
    altKey: keys.alt ?? false,
    shiftKey: keys.shift ?? false,
    repeat: keys.repeat ?? false,
  };
}

function remapped(remapping: Remapping): ShortcutSettings {
  if (remapping.outcome !== 'remapped') throw new Error(`Not remapped: ${remapping.outcome}`);
  return remapping.settings;
}

const F9: KeyChord = { key: 'f9' };

describe('default key map', () => {
  it('holds the shortcuts of Milestones 1 to 3', () => {
    expect(keyLabelOf('undo')).toBe('Ctrl+Z');
    expect(KEY_MAP.keys.redo.map(chordLabel)).toEqual(['Ctrl+Y', 'Ctrl+Maj+Z']);
    expect(keyLabelOf('activate')).toBe('Ctrl+Entrée');
    expect(keyLabelOf('activate-next')).toBe('Ctrl+↓');
    expect(keyLabelOf('activate-previous')).toBe('Ctrl+↑');
    expect(keyLabelOf('move-scene-up')).toBe('Alt+↑');
    expect(keyLabelOf('blackout')).toBe('B');
    expect(keyLabelOf('silence')).toBe('S');
    expect(KEY_MAP.keys['pad-4'].map(chordLabel)).toEqual(['4', 'Pavé 4']);
    expect(KEY_MAP.cutModifier).toBe('shift');
  });

  it('lets every shortcut but undo and redo be remapped, a new row included with no code', () => {
    expect(REMAPPABLE_SHORTCUTS).not.toContain('undo');
    expect(REMAPPABLE_SHORTCUTS).not.toContain('redo');
    const rows = Object.keys(SHORTCUT_ROWS).filter((s) => s !== 'undo' && s !== 'redo');
    expect(REMAPPABLE_SHORTCUTS).toEqual(rows);
  });

  it('gives keys in aria-keyshortcuts syntax, each once', () => {
    expect(ariaKeyShortcutsOf('activate')).toBe('Control+Enter');
    expect(ariaKeyShortcutsOf('activate-next')).toBe('Control+ArrowDown');
    expect(ariaKeyShortcutsOf('redo')).toBe('Control+Y Control+Shift+Z');
    expect(ariaKeyShortcutsOf('blackout')).toBe('B');
    // The number row and the numpad both give "1".
    expect(ariaKeyShortcutsOf('pad-1')).toBe('1');
  });
});

describe('reading a key press', () => {
  it('reads digits by position and letters by character (AZERTY)', () => {
    expect(chordOf(press('&', 'Digit1'))).toEqual({ code: 'Digit1' });
    expect(chordOf(press('1', 'Numpad1'))).toEqual({ code: 'Numpad1' });
    // On AZERTY, the key printed A is where QWERTY has Q.
    expect(chordOf(press('a', 'KeyQ'))).toEqual({ key: 'a' });
    expect(chordOf(press('B', 'KeyB', { shift: true }))).toEqual({ key: 'b', shift: true });
    expect(chordOf(press('Enter', 'Enter', { meta: true }))).toEqual({ key: 'enter', ctrl: true });
  });

  it('finds the shortcut of a remapped key and no longer the old one', () => {
    const keyMap = keyMapOf(remapped(assignKey(DEFAULT_SHORTCUTS, 'silence', F9)));
    expect(shortcutPressed(press('F9', 'F9'), keyMap)).toBe('silence');
    expect(shortcutPressed(press('s', 'KeyS'), keyMap)).toBeUndefined();
    expect(keyLabelOf('silence', keyMap)).toBe('F9');
  });

  it('answers an Activate key with or without the Cut modifier, whichever it is', () => {
    const alt = keyMapOf(remapped(assignCutModifier(DEFAULT_SHORTCUTS, 'alt')));
    expect(shortcutPressed(press('Enter', 'Enter', { ctrl: true, alt: true }), alt)).toBe(
      'activate',
    );
    expect(
      shortcutPressed(press('Enter', 'Enter', { ctrl: true, shift: true }), alt),
    ).toBeUndefined();
  });
});

describe('assigning a key', () => {
  it('replaces every key of the shortcut', () => {
    const settings = remapped(assignKey(DEFAULT_SHORTCUTS, 'pad-1', { key: 'q' }));
    expect(keyMapOf(settings).keys['pad-1']).toEqual([{ key: 'q' }]);
  });

  it('names the shortcut holding the key, and changes nothing', () => {
    expect(assignKey(DEFAULT_SHORTCUTS, 'silence', { key: 'b' })).toEqual({
      outcome: 'taken',
      holders: ['blackout'],
    });
  });

  it('takes the key from its holder on "Remplacer": one shortcut per key', () => {
    const settings = remapped(assignKey(DEFAULT_SHORTCUTS, 'silence', { key: 'b' }, true));
    const keyMap = keyMapOf(settings);
    expect(keyMap.keys.silence).toEqual([{ key: 'b' }]);
    expect(keyMap.keys.blackout).toEqual([]);
    expect(shortcutPressed(press('b', 'KeyB'), keyMap)).toBe('silence');
  });

  it('takes only the key asked for: a pad keeps its other key', () => {
    const settings = remapped(assignKey(DEFAULT_SHORTCUTS, 'blackout', { code: 'Numpad1' }, true));
    expect(keyMapOf(settings).keys['pad-1']).toEqual([{ code: 'Digit1' }]);
  });

  it('counts an Activate key with the Cut modifier as taken too', () => {
    // Activate on B also takes Maj+B; Silence on Maj+B is named.
    const settings = remapped(assignKey(DEFAULT_SHORTCUTS, 'silence', { key: 'b', shift: true }));
    expect(assignKey(settings, 'activate', { key: 'b' }, false)).toEqual({
      outcome: 'taken',
      holders: ['blackout', 'silence'],
    });
  });

  it('can give a shortcut its own key back', () => {
    expect(assignKey(DEFAULT_SHORTCUTS, 'blackout', { key: 'b' }).outcome).toBe('remapped');
  });
});

describe('reserved keys', () => {
  it.each<[string, KeyChord]>([
    ['Ctrl+Z (undo)', { key: 'z', ctrl: true }],
    ['Ctrl+Y (redo)', { key: 'y', ctrl: true }],
    ['Ctrl+Maj+Z (redo)', { key: 'z', ctrl: true, shift: true }],
    ['Escape', { key: 'escape' }],
    ['Tab', { key: 'tab' }],
    ['Maj+Tab', { key: 'tab', shift: true }],
    ['F11', { key: 'f11' }],
    ['Ctrl alone', { key: 'control', ctrl: true }],
    ['Maj alone', { key: 'shift', shift: true }],
    ['Alt Gr alone', { key: 'altgraph', ctrl: true, alt: true }],
    ['a dead key', { key: 'dead' }],
    ['Backspace', { key: 'backspace' }],
    ['Delete', { key: 'delete' }],
    ['Enter alone', { key: 'enter' }],
    ['Space alone', { key: ' ' }],
    ['Ctrl+C', { key: 'c', ctrl: true }],
    ['Ctrl+V', { key: 'v', ctrl: true }],
    ['Alt+F4', { key: 'f4', alt: true }],
    ['↓ alone', { key: 'arrowdown' }],
    ['← alone', { key: 'arrowleft' }],
    ['Maj+↑', { key: 'arrowup', shift: true }],
    ['Home', { key: 'home' }],
    ['End', { key: 'end' }],
    ['Page Up', { key: 'pageup' }],
    ['Page Down', { key: 'pagedown' }],
    ['Ctrl+Backspace', { key: 'backspace', ctrl: true }],
  ])('refuses %s, with a reason', (_name, chord) => {
    const remapping = assignKey(DEFAULT_SHORTCUTS, 'blackout', chord);
    expect(remapping.outcome).toBe('refused');
    expect(remapping).toHaveProperty('reason', expect.stringMatching(/\S/));
  });

  it('refuses the Cut modifier in an Activate key', () => {
    expect(assignKey(DEFAULT_SHORTCUTS, 'activate', { key: 'a', shift: true })).toEqual({
      outcome: 'refused',
      reason: expect.stringContaining('Maj force le Cut'),
    });
    // Another shortcut may use Shift.
    expect(assignKey(DEFAULT_SHORTCUTS, 'blackout', { key: 'a', shift: true }).outcome).toBe(
      'remapped',
    );
  });

  it('refuses an Activate key that would be redo with the Cut modifier', () => {
    expect(assignKey(DEFAULT_SHORTCUTS, 'activate', { key: 'z', ctrl: true }).outcome).toBe(
      'refused',
    );
  });

  it('never remaps undo or redo', () => {
    expect(assignKey(DEFAULT_SHORTCUTS, 'undo', F9).outcome).toBe('refused');
  });

  it('allows Ctrl+Enter, Ctrl+Space, Ctrl+arrows, Alt+Home and F4 alone', () => {
    for (const chord of [
      { key: ' ', ctrl: true },
      { key: 'arrowleft', ctrl: true },
      { key: 'home', alt: true },
      { key: 'f4' },
    ]) {
      expect(assignKey(DEFAULT_SHORTCUTS, 'blackout', chord).outcome).toBe('remapped');
    }
  });

  it.each<[string, ShortcutSettings['cutModifier'], KeyChord]>([
    ['Ctrl+X', 'ctrl', { key: 'x' }],
    ['Ctrl+A', 'ctrl', { key: 'a' }],
    ['Alt+F4', 'alt', { key: 'f4' }],
  ])('refuses an Activate key that the Cut modifier would make %s', (_name, cutModifier, chord) => {
    const settings: ShortcutSettings = { keys: { activate: [] }, cutModifier };
    expect(assignKey(settings, 'activate', chord).outcome).toBe('refused');
    // Another shortcut takes no Cut modifier: the key alone is fine there.
    expect(assignKey(settings, 'blackout', chord).outcome).toBe('remapped');
  });

  it('drops a stored key that is now reserved', () => {
    const settings: ShortcutSettings = {
      keys: { blackout: [{ key: 'arrowleft' }] },
      cutModifier: 'shift',
    };
    expect(keyMapOf(settings).keys.blackout).toEqual([]);
    expect(isConsistent(settings)).toBe(false);
  });
});

describe('the Cut modifier', () => {
  it('is refused when an Activate key would become a reserved key with it', () => {
    const settings = remapped(assignKey(DEFAULT_SHORTCUTS, 'activate', { key: 'f4' }));
    expect(assignCutModifier(settings, 'alt')).toEqual({
      outcome: 'refused',
      reason: expect.stringContaining('Alt+F4'),
    });
    const copying = remapped(assignKey(DEFAULT_SHORTCUTS, 'activate', { key: 'c' }));
    expect(assignCutModifier(copying, 'ctrl').outcome).toBe('refused');
  });

  it('is refused when an Activate key holds it', () => {
    expect(assignCutModifier(DEFAULT_SHORTCUTS, 'ctrl')).toEqual({
      outcome: 'refused',
      reason: expect.stringContaining('Ctrl'),
    });
  });

  it('names a shortcut whose key an Activate key would take with it', () => {
    // Activate next with Alt would be Ctrl+Alt+↓: give it to Blackout first.
    const settings = remapped(
      assignKey(DEFAULT_SHORTCUTS, 'blackout', { key: 'arrowdown', ctrl: true, alt: true }),
    );
    expect(assignCutModifier(settings, 'alt')).toEqual({ outcome: 'taken', holders: ['blackout'] });
    const replaced = keyMapOf(remapped(assignCutModifier(settings, 'alt', true)));
    expect(replaced.cutModifier).toBe('alt');
    expect(replaced.keys.blackout).toEqual([]);
    expect(replaced.keys['activate-next']).toEqual([{ key: 'arrowdown', ctrl: true }]);
  });
});

describe('unbinding and reset', () => {
  it('leaves a shortcut with no key', () => {
    const keyMap = keyMapOf(unbindShortcut(DEFAULT_SHORTCUTS, 'blackout'));
    expect(keyMap.keys.blackout).toEqual([]);
    expect(keyLabelOf('blackout', keyMap)).toBeUndefined();
    expect(shortcutPressed(press('b', 'KeyB'), keyMap)).toBeUndefined();
  });

  it('restores every default from the default settings', () => {
    let settings = remapped(assignKey(DEFAULT_SHORTCUTS, 'silence', { key: 'b' }, true));
    settings = remapped(assignCutModifier(settings, 'alt'));
    expect(keyMapOf(settings)).not.toEqual(KEY_MAP);
    expect(keyMapOf(DEFAULT_SHORTCUTS)).toEqual(KEY_MAP);
  });
});

describe('keys in force', () => {
  it('never lets a default take a key a remapped shortcut holds', () => {
    // As if a later version gave Blackout's default key to Silence: the remapping wins.
    const settings: ShortcutSettings = { keys: { silence: [{ key: 'b' }] }, cutModifier: 'shift' };
    const keyMap = keyMapOf(settings);
    expect(keyMap.keys.silence).toEqual([{ key: 'b' }]);
    expect(keyMap.keys.blackout).toEqual([]);
  });

  it('drops a reserved or twice-taken key a file holds, and says it is not consistent', () => {
    const settings: ShortcutSettings = {
      keys: { blackout: [{ key: 'escape' }], silence: [{ key: 'q' }], 'pad-1': [{ key: 'q' }] },
      cutModifier: 'shift',
    };
    const keyMap = keyMapOf(settings);
    expect(keyMap.keys.blackout).toEqual([]);
    expect(keyMap.keys.silence).toEqual([{ key: 'q' }]);
    expect(keyMap.keys['pad-1']).toEqual([]);
    expect(isConsistent(settings)).toBe(false);
    expect(isConsistent(remapped(assignKey(DEFAULT_SHORTCUTS, 'silence', F9)))).toBe(true);
  });
});

describe('stored and sent shortcut settings', () => {
  it('keep what can be read, dropping the rest', () => {
    expect(
      parseShortcutSettings({
        keys: {
          silence: [{ key: 'f9' }, { key: 'F9' }, { code: 'KeyA' }, 'b'],
          undo: [{ key: 'u' }],
          unknown: [{ key: 'u' }],
          blackout: 'b',
        },
        cutModifier: 'meta',
      }),
    ).toEqual({ keys: { silence: [{ key: 'f9' }] }, cutModifier: 'shift' });
    expect(parseShortcutSettings(undefined)).toEqual(DEFAULT_SHORTCUTS);
  });

  it('refuse a window message with any unreadable part', () => {
    const good = { keys: { silence: [{ key: 'f9', ctrl: true }] }, cutModifier: 'alt' };
    expect(shortcutSettingsOf(good)).toEqual(good);
    expect(shortcutSettingsOf({ ...good, cutModifier: 'meta' })).toBeUndefined();
    expect(shortcutSettingsOf({ keys: { undo: [] }, cutModifier: 'shift' })).toBeUndefined();
    expect(
      shortcutSettingsOf({ keys: { silence: [{ key: 'f9', ctrl: 1 }] }, cutModifier: 'shift' }),
    ).toBeUndefined();
    expect(shortcutSettingsOf({ keys: { nope: [] }, cutModifier: 'shift' })).toBeUndefined();
  });
});
