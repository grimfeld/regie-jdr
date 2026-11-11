/**
 * Keyboard shortcuts of the Control window. A shortcut never fires while the Game Master is
 * typing in a field: there the keys keep their text meaning (Ctrl+Z undoes typing). Every
 * window-wide shortcut checks `isTypingIn` first.
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

/** Whether `target` (a key event's target) is a place where the Game Master types text. */
export function isTypingIn(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(target.type);
  return false;
}

/** The Scene edit shortcuts: Ctrl+Z undoes, Ctrl+Y or Ctrl+Shift+Z redoes. */
export type EditShortcut = 'undo' | 'redo';

/** The Scene edit shortcut a key press means, if any; none while typing in a field. */
export function editShortcutOf(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'target'>,
): EditShortcut | undefined {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || isTypingIn(event.target)) {
    return undefined;
  }
  switch (event.key.toLowerCase()) {
    case 'z':
      return event.shiftKey ? 'redo' : 'undo';
    case 'y':
      return event.shiftKey ? undefined : 'redo';
    default:
      return undefined;
  }
}
