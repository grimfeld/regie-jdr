// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { editShortcutOf, isTypingIn } from '../../src/keyboard';

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

describe('Scene edit shortcuts', () => {
  const press = (key: string, keys: { shift?: boolean; alt?: boolean; meta?: boolean } = {}) => ({
    key,
    ctrlKey: !keys.meta,
    metaKey: keys.meta ?? false,
    altKey: keys.alt ?? false,
    shiftKey: keys.shift ?? false,
    target: document.body,
  });

  it('reads Ctrl+Z as undo, Ctrl+Y and Ctrl+Shift+Z as redo', () => {
    expect(editShortcutOf(press('z'))).toBe('undo');
    expect(editShortcutOf(press('Z', { shift: true }))).toBe('redo');
    expect(editShortcutOf(press('y'))).toBe('redo');
    expect(editShortcutOf(press('z', { meta: true }))).toBe('undo');
  });

  it('ignores other keys, Alt, and keys without Ctrl', () => {
    expect(editShortcutOf(press('x'))).toBeUndefined();
    expect(editShortcutOf(press('z', { alt: true }))).toBeUndefined();
    expect(editShortcutOf({ ...press('z'), ctrlKey: false })).toBeUndefined();
  });

  it('never fires while typing in a field', () => {
    expect(editShortcutOf({ ...press('z'), target: input('text') })).toBeUndefined();
    expect(editShortcutOf({ ...press('y'), target: input('checkbox') })).toBe('redo');
  });
});
