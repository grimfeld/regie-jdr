# Subsystem: keyboard shortcuts

Source: #41 report, 2026-11-12. True as of `m2-audio-mvp@2879653`.

- Every shortcut is a row of `KEY_MAP` in `src/keyboard.ts`, read by `shortcutOf(press, keyMap?)`, labelled by `keyLabelOf`, handled via `useShortcuts(handlers)`. `editShortcutOf` is gone (#32's undo/redo moved into `KEY_MAP`). Typing check: `isTypingIn` (a focused `<select>` is not typing).
- M2 bindings: 1–9 (number row or numpad) press the first nine pads; S toggles Silence (agent's choice; issue said only "a dedicated key"). Pad/Silence wiring: `useAudioShortcuts` in `src/App.tsx`.
- Digits match on `event.code` (no Shift on AZERTY); letters on `event.key`. Pads and Silence ignore auto-repeat; undo/redo repeat.
- Keys shown as `kbd` with `aria-keyshortcuts` on pads and the Silence button.
- Broadcast window key presses never reach the Control window.
- Test quirk: Playwright's Numpad press into a text field types nothing; typing test uses Digit1.
- #49 (2026-11-12): Activate with or without a forced Cut is `activateScene` + `activateOptionsOf(event)` in `src/activate.ts`. #56's Ctrl+Enter / Ctrl+↓ / Ctrl+↑ call them; Shift on the key press gives the Cut.
- #56 (2026-11-12): Ctrl+Entrée Activates the Selected Scene, Ctrl+↓ / Ctrl+↑ the Scene after / before the Active Scene (`sceneNextTo`; nothing on air → first; no wrap; Selected Scene unchanged), handled in `ScenesPanel`. B toggles Blackout (`OnAirMonitor`). Activate shortcuts are in `SHIFT_FREE`: they match with or without Shift, and handlers now receive the key press (`ShortcutHandlers` take `(press) => void`) to read Shift for `activateOptionsOf`. None repeat.
- #56: `isTypingIn` also counts anything inside editable content (`closest('[contenteditable]:not([contenteditable="false"])')`), so a Notes image's resize handle is typing. Ctrl+↓/↑ have no button: their keys are in the Activate button's title.

## Remapping (#71, 2026-11-12, `m4-campaign-themes-qol@e4c0257`)

- Supersedes "`KEY_MAP` in `src/keyboard.ts`": the key map lives in `core/keyMap.ts` (renderer-safe); each row carries its French name, so new rows are listed and remappable with no other code. All rows remappable except undo/redo (reserved).
- Settings v6 stores only keys that differ from defaults, plus the Cut modifier (Maj, Alt or Ctrl; refused if an Activate key already uses it). Control-only `settings:set-shortcuts` refuses reserved or duplicate keys.
- Resolution: fixed shortcuts, then remapped, then defaults; a refused or taken key is dropped (a later default that clashes loses its key). Digits stored by physical position, other keys by character.
- UI: "Raccourcis" modal; conflicts name the holder, "Remplacer" frees the key; reserved keys refused with a reason; "Rétablir les raccourcis par défaut"; shortcuts paused while open.
- `aria-keyshortcuts` now ARIA syntax (`Control+Enter`).
