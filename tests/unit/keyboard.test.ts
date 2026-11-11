// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isTypingIn, KEY_MAP, keyLabelOf, shortcutOf, type KeyMap } from '../../src/keyboard';

function input(type: string) {
  const element = document.createElement('input');
  element.type = type;
  return element;
}

describe('typing in a field', () => {
  it.each(['text', 'search', 'number', 'email', 'password', 'url'])(
    'is true in an input of type %s',
    (type) => {
      expect(isTypingIn(input(type))).toBe(true);
    },
  );

  it('is true in a text area and in editable content', () => {
    expect(isTypingIn(document.createElement('textarea'))).toBe(true);
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    // jsdom does not compute isContentEditable; a browser does.
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    expect(isTypingIn(editable)).toBe(true);
  });

  it.each(['checkbox', 'radio', 'range', 'button'])('is false in an input of type %s', (type) => {
    expect(isTypingIn(input(type))).toBe(false);
  });

  it('is false on a button, a list, the page or nothing', () => {
    expect(isTypingIn(document.createElement('button'))).toBe(false);
    expect(isTypingIn(document.createElement('select'))).toBe(false);
    expect(isTypingIn(document.body)).toBe(false);
    expect(isTypingIn(null)).toBe(false);
  });
});

/** A key press on the page, with no modifier unless given. */
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
    target: document.body as EventTarget,
  };
}

describe('Scene edit shortcuts', () => {
  it('reads Ctrl+Z as undo, Ctrl+Y and Ctrl+Shift+Z as redo', () => {
    expect(shortcutOf(press('z', 'KeyZ', { ctrl: true }))).toBe('undo');
    expect(shortcutOf(press('Z', 'KeyZ', { ctrl: true, shift: true }))).toBe('redo');
    expect(shortcutOf(press('y', 'KeyY', { ctrl: true }))).toBe('redo');
    expect(shortcutOf(press('z', 'KeyZ', { meta: true }))).toBe('undo');
  });

  it('follows the letter printed on the key (Ctrl+Z on a French keyboard)', () => {
    expect(shortcutOf(press('z', 'KeyW', { ctrl: true }))).toBe('undo');
  });

  it('ignores other keys, Alt, and keys without Ctrl', () => {
    expect(shortcutOf(press('x', 'KeyX', { ctrl: true }))).toBeUndefined();
    expect(shortcutOf(press('z', 'KeyZ', { ctrl: true, alt: true }))).toBeUndefined();
    expect(shortcutOf(press('y', 'KeyY', { ctrl: true, shift: true }))).toBeUndefined();
    expect(shortcutOf(press('z', 'KeyZ'))).toBeUndefined();
  });

  it('repeats while held', () => {
    expect(shortcutOf(press('z', 'KeyZ', { ctrl: true, repeat: true }))).toBe('undo');
  });

  it('never fires while typing in a field', () => {
    const typing = { ...press('z', 'KeyZ', { ctrl: true }), target: input('text') };
    expect(shortcutOf(typing)).toBeUndefined();
    expect(shortcutOf({ ...press('y', 'KeyY', { ctrl: true }), target: input('checkbox') })).toBe(
      'redo',
    );
  });
});

describe('Soundboard and Silence shortcuts', () => {
  it.each([1, 2, 5, 9])('plays pad %i from the number row and the numpad', (position) => {
    expect(shortcutOf(press(String(position), `Digit${position}`))).toBe(`pad-${position}`);
    expect(shortcutOf(press(String(position), `Numpad${position}`))).toBe(`pad-${position}`);
  });

  it('reads the number row by key position, so a French keyboard needs no Shift', () => {
    expect(shortcutOf(press('&', 'Digit1'))).toBe('pad-1');
    expect(shortcutOf(press('ç', 'Digit9'))).toBe('pad-9');
  });

  it('leaves 0 and modified number keys alone', () => {
    expect(shortcutOf(press('0', 'Digit0'))).toBeUndefined();
    expect(shortcutOf(press('1', 'Digit1', { ctrl: true }))).toBeUndefined();
    expect(shortcutOf(press('1', 'Digit1', { alt: true }))).toBeUndefined();
  });

  it('toggles Silence with S, in either case, and not with Ctrl+S', () => {
    expect(shortcutOf(press('s', 'KeyS'))).toBe('silence');
    expect(shortcutOf(press('S', 'KeyS'))).toBe('silence');
    expect(shortcutOf(press('s', 'KeyS', { ctrl: true }))).toBeUndefined();
  });

  it('fires once per press, not again while the key is held', () => {
    expect(shortcutOf(press('1', 'Digit1', { repeat: true }))).toBeUndefined();
    expect(shortcutOf(press('s', 'KeyS', { repeat: true }))).toBeUndefined();
  });

  it('never fires while typing in a field, but does on a slider or a button', () => {
    expect(shortcutOf({ ...press('1', 'Digit1'), target: input('text') })).toBeUndefined();
    expect(shortcutOf({ ...press('s', 'KeyS'), target: input('search') })).toBeUndefined();
    expect(shortcutOf({ ...press('1', 'Digit1'), target: input('range') })).toBe('pad-1');
    const button = document.createElement('button');
    expect(shortcutOf({ ...press('s', 'KeyS'), target: button })).toBe('silence');
  });
});

describe('keys a control or the canvas editor answers', () => {
  it('never fire a shortcut once already answered (the selected Overlay nudged)', () => {
    const answered = { ...press('ArrowDown', 'ArrowDown', { ctrl: true }), defaultPrevented: true };
    expect(shortcutOf(answered)).toBeUndefined();
    expect(shortcutOf({ ...answered, defaultPrevented: false })).toBe('activate-next');
  });

  it('leave a slider its arrows, Home, End and Page keys, whatever the modifier', () => {
    const slider = input('range');
    const ctrlDown = press('ArrowDown', 'ArrowDown', { ctrl: true });
    expect(shortcutOf({ ...ctrlDown, target: slider })).toBeUndefined();
    const altUp = press('ArrowUp', 'ArrowUp', { alt: true });
    expect(shortcutOf({ ...altUp, target: slider })).toBeUndefined();
    const custom = document.createElement('div');
    custom.setAttribute('role', 'slider');
    expect(shortcutOf({ ...ctrlDown, target: custom })).toBeUndefined();
    // Other keys still work there.
    expect(shortcutOf({ ...press('b', 'KeyB'), target: slider })).toBe('blackout');
  });

  it('leave a drop-down list every key', () => {
    const select = document.createElement('select');
    expect(shortcutOf({ ...press('b', 'KeyB'), target: select })).toBeUndefined();
    const ctrlDown = press('ArrowDown', 'ArrowDown', { ctrl: true });
    expect(shortcutOf({ ...ctrlDown, target: select })).toBeUndefined();
  });
});

describe('key map', () => {
  it('shows each shortcut by its first key', () => {
    expect(keyLabelOf('silence')).toBe('S');
    expect(keyLabelOf('pad-3')).toBe('3');
    expect(keyLabelOf('undo')).toBe('Ctrl+Z');
  });

  it('reads another key map in place of the default one', () => {
    const remapped: KeyMap = { ...KEY_MAP, keys: { ...KEY_MAP.keys, silence: [{ key: 'f9' }] } };
    expect(shortcutOf(press('F9', 'F9'), remapped)).toBe('silence');
    expect(shortcutOf(press('s', 'KeyS'), remapped)).toBeUndefined();
    expect(keyLabelOf('silence', remapped)).toBe('F9');
  });
});

describe('Scene shortcuts', () => {
  it('Activates with Ctrl+Enter and steps with Ctrl+Down and Ctrl+Up', () => {
    expect(shortcutOf(press('Enter', 'Enter', { ctrl: true }))).toBe('activate');
    expect(shortcutOf(press('Enter', 'NumpadEnter', { ctrl: true }))).toBe('activate');
    expect(shortcutOf(press('ArrowDown', 'ArrowDown', { ctrl: true }))).toBe('activate-next');
    expect(shortcutOf(press('ArrowUp', 'ArrowUp', { meta: true }))).toBe('activate-previous');
  });

  it('answers with Shift held too, which the handler reads to force a Cut', () => {
    expect(shortcutOf(press('Enter', 'Enter', { ctrl: true, shift: true }))).toBe('activate');
    expect(shortcutOf(press('ArrowDown', 'ArrowDown', { ctrl: true, shift: true }))).toBe(
      'activate-next',
    );
  });

  it('leaves Enter and the arrows alone without Ctrl, or with Alt', () => {
    expect(shortcutOf(press('Enter', 'Enter'))).toBeUndefined();
    expect(shortcutOf(press('ArrowDown', 'ArrowDown'))).toBeUndefined();
    expect(shortcutOf(press('ArrowUp', 'ArrowUp', { ctrl: true, alt: true }))).toBeUndefined();
  });

  it('toggles Blackout with B, not with Ctrl+B or Shift+B', () => {
    expect(shortcutOf(press('b', 'KeyB'))).toBe('blackout');
    expect(shortcutOf(press('b', 'KeyB', { ctrl: true }))).toBeUndefined();
    expect(shortcutOf(press('B', 'KeyB', { shift: true }))).toBeUndefined();
  });

  it('fires once per press, not again while the key is held', () => {
    expect(
      shortcutOf(press('ArrowDown', 'ArrowDown', { ctrl: true, repeat: true })),
    ).toBeUndefined();
    expect(shortcutOf(press('b', 'KeyB', { repeat: true }))).toBeUndefined();
  });

  it('never fires while typing in a field or anywhere inside editable content', () => {
    expect(
      shortcutOf({ ...press('Enter', 'Enter', { ctrl: true }), target: input('text') }),
    ).toBeUndefined();
    // The Notes editor: a button inside it (an image's resize handle) is still in the editor.
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    const handle = document.createElement('button');
    const view = document.createElement('div');
    view.setAttribute('contenteditable', 'false');
    view.append(handle);
    editor.append(view);
    document.body.append(editor);
    expect(shortcutOf({ ...press('b', 'KeyB'), target: handle })).toBeUndefined();
    editor.remove();
  });

  it('shows Activate and Blackout keys', () => {
    expect(keyLabelOf('activate')).toBe('Ctrl+Entrée');
    expect(keyLabelOf('activate-next')).toBe('Ctrl+↓');
    expect(keyLabelOf('activate-previous')).toBe('Ctrl+↑');
    expect(keyLabelOf('blackout')).toBe('B');
  });
});

describe('running order shortcuts', () => {
  it('moves a Scene up with Alt+Up and down with Alt+Down, repeating while held', () => {
    expect(shortcutOf(press('ArrowUp', 'ArrowUp', { alt: true }))).toBe('move-scene-up');
    expect(shortcutOf(press('ArrowDown', 'ArrowDown', { alt: true }))).toBe('move-scene-down');
    expect(shortcutOf(press('ArrowDown', 'ArrowDown', { alt: true, repeat: true }))).toBe(
      'move-scene-down',
    );
  });

  it('keeps Ctrl+Up and Ctrl+Down for Activate, and refuses other modifiers', () => {
    expect(shortcutOf(press('ArrowUp', 'ArrowUp', { ctrl: true }))).toBe('activate-previous');
    expect(shortcutOf(press('ArrowUp', 'ArrowUp', { alt: true, shift: true }))).toBeUndefined();
    expect(shortcutOf(press('ArrowDown', 'ArrowDown', { alt: true, meta: true }))).toBeUndefined();
  });

  it('never fires while typing in a field', () => {
    expect(
      shortcutOf({ ...press('ArrowUp', 'ArrowUp', { alt: true }), target: input('text') }),
    ).toBeUndefined();
  });

  it('shows its keys', () => {
    expect(keyLabelOf('move-scene-up')).toBe('Alt+↑');
    expect(keyLabelOf('move-scene-down')).toBe('Alt+↓');
  });
});
