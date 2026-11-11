# Subsystem: keyboard shortcuts

Source: #41 report, 2026-11-12. True as of `m2-audio-mvp@2879653`.

- Every shortcut is a row of `KEY_MAP` in `src/keyboard.ts`, read by `shortcutOf(press, keyMap?)`, labelled by `keyLabelOf`, handled via `useShortcuts(handlers)`. `editShortcutOf` is gone (#32's undo/redo moved into `KEY_MAP`). Typing check: `isTypingIn` (a focused `<select>` is not typing).
- M2 bindings: 1–9 (number row or numpad) press the first nine pads; S toggles Silence (agent's choice; issue said only "a dedicated key"). Pad/Silence wiring: `useAudioShortcuts` in `src/App.tsx`.
- Digits match on `event.code` (no Shift on AZERTY); letters on `event.key`. Pads and Silence ignore auto-repeat; undo/redo repeat.
- Keys shown as `kbd` with `aria-keyshortcuts` on pads and the Silence button.
- Broadcast window key presses never reach the Control window.
- Test quirk: Playwright's Numpad press into a text field types nothing; typing test uses Digit1.
- #49 (2026-11-12): Activate with or without a forced Cut is `activateScene` + `activateOptionsOf(event)` in `src/activate.ts`. #56's Ctrl+Enter / Ctrl+↓ / Ctrl+↑ call them; Shift on the key press gives the Cut.
