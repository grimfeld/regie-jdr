# Subsystem: Scene rendering and Scene edits

Source: #22 agent report, 2026-11-11. True as of `grimfeld/regie-jdr@90ddedc`. Design record: `docs/adr/0003-*`.

## Rendering

- Layout math is one pure function, `layOutCanvas` in `core/canvas.ts` (fractions to pixels, 16:9 letterbox).
- `src/SceneCanvas.tsx` draws its result for the editor, the On-air monitor and the Broadcast window. It takes an `OnAirScene`, or a Picture whose `hidden`/`labelHidden` flags let the editor show Hidden items faded.
- The broadcast projection is `onAirSceneOf`: visible items, the Scene title, Media addresses, plus `OnAirState.blackout`. Nothing else may reach the Broadcast window.

## Adding a Scene edit (pattern every M1 to M3 slice follows)

- Windows send a `SceneEdit` command over `scenes:edit` (`shared/contract.ts`). The old `scenes:update` (whole Scene) is gone.
- `editScene` in the core applies the pure `applySceneEdit`, saves, and puts the Scene on air if it is active.
- A new edit = a new `SceneEdit` variant + its case in `applySceneEdit` + its case in `parseSceneEdit`, with unit tests.
- Undo (#32) adds its history inside `editScene`.

## Data shape

- `scenes.json` schema 2 (tested migration from 1) already holds the M1 fields: Scene title, Cover/Contain, zoom and focal point, Overlay height, Overlay order by list position, Labels as `{text, visible}`.
- Built ahead of their slices: `OnAir.setBlackout` (#23 owns the command and button), `place-overlay` edit (#26 owns placing by drag).

## Choices open to review (2026-11-11)

- Esc leaves fullscreen via main-process `before-input-event`; the Playwright test uses `sendInputEvent` because Playwright's keyboard bypasses that hook.
- `canvas` and `guards` joined `RENDERER_SAFE_CORE` in `eslint.config.mjs`.
- "broadcast projection" is not in `GLOSSARY.md` yet; needs `/domain-modeling`. Raise in the M1 PR.
