# Subsystem: rich Notes

Source: #51 report, 2026-11-12. True as of `m3-transitions-closeout@30645d0`. Design: ADR-0004 (ProseMirror JSON).

- Editor: TipTap, `@tiptap/*` pinned 3.32.2, in `src/SceneNotes.tsx`, placed in the control column below the Soundboard (portaled via `notesSlot`), not inside the Scene editor. CSP blocks TipTap's injected style: `injectCSS` off, base CSS copied into `styles.css`.
- Storage: `scenes.json` v3; plain-text notes migrate to one paragraph per line. `core/notes.ts` (renderer-safe): `parseNotes` keeps allowed nodes/marks, caps size and depth, refuses links, tables, colours.
- Undo (decision): `SceneEdit` `set-notes` via `editScene` is saved only: never on air, no Scene undo step. Scene undo/redo restore with current Notes (`withNotesOf`), so they never revert typing. Notes undo is TipTap history (Ctrl+Z/Ctrl+Y in the editor, two buttons). Save 500 ms after last change, at once on blur or Scene switch.
- #52 extension point: add the image node as a row in `BLOCK_NODES` and the matching extension in `src/SceneNotes.tsx`.
- Gap: a save pending under 500 ms may be lost if the app quits then.

## Notes images and Reference category (#52, 2026-11-12, `m3-transitions-closeout@f936525`)

- Paste: channel `media:import-pasted` (bytes + name), 1 B to 50 MB (`MAX_PASTED_IMAGE_BYTES`); main sniffs type from content (PNG/JPEG/WebP only); Chromium's "image.png" becomes "Image collée". A paste that also carries plain text stays a text paste.
- Media ids in Notes must be lower-case UUIDs (rules out paths and embedded data).
- Reference image dropped on the canvas becomes an Overlay at the drop point.
- Media index schema 3 (empty migration) so older builds refuse libraries with Reference images.
- Hooks: #53 adds a width attribute to the image row in `core/notes.ts` and `src/NotesImage.tsx`. #54 must count Notes images as Media uses (today deleting one shows "Média manquant" in Notes).
