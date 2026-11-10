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
- Built ahead of their slices: `OnAir.setBlackout` (#23 added the command and button on 2026-11-11, `caf0d4b`), `place-overlay` edit (#26 owns placing by drag).

## Choices open to review (2026-11-11)

- Esc leaves fullscreen via main-process `before-input-event`; the Playwright test uses `sendInputEvent` because Playwright's keyboard bypasses that hook.
- `canvas` and `guards` joined `RENDERER_SAFE_CORE` in `eslint.config.mjs`.
- "broadcast projection" is not in `GLOSSARY.md` yet; needs `/domain-modeling`. Raise in the M1 PR.
- As of `caf0d4b`, windows subscribe to on-air state through `src/useOnAir.ts` (subscribe then read). Reuse it; do not copy the logic.
- As of `8198f81`, `tests/unit/broadcastProjection.test.ts` holds an allow-list for every field of Scene, Background, Overlay, Label and OnAirState. Adding a field fails typecheck until the slice states whether it goes on air. Expect to touch this list when adding Scene data.

## Scene list and editor (#24, 2026-11-11, `4555b1c`)

- Rename is a `SceneEdit` (`kind: 'rename'`), so undo covers it. Delete is a separate command (`commands.deleteScene`, `scenes:delete`) outside undo; deleting the Active Scene calls `OnAir.clearActiveScene` and leaves Blackout as is.
- `editorPictureOf` (`core/onAir.ts`) builds the editor's full picture with Hidden placements and Labels marked.
- Renommer, Supprimer, Activer sit in the editor heading and act on the Selected Scene only.

## Placing Media and the placement lists (#26, 2026-11-11, `b8a3580`)

- New `SceneEdit` `remove-placement` (undo-covered).
- Drop rule: `placementEdit(image, target, dropPoint?)` in `core/sceneEdits.ts`, pure and renderer-safe. A drop on the black bars snaps to the nearest canvas edge.
- UI entry for placing: `place(scene, image, target, dropPoint)` in `src/ScenesPanel.tsx`, beside `placeDropped`. Drag payload check: `carriesMedia` in `src/mediaDrag.ts`, used by `useDropTarget` in `src/PlacementLists.tsx`.
- `BackgroundList` and `OverlayList` (`src/PlacementLists.tsx`) list items in stored order, bottom of the stack first. Each row is a `PlacementRow` taking children for extra controls.
- Plug-in points: #27 adds a files branch next to `placeDropped` and extends `carriesMedia`; #28 fit/zoom controls in Background rows (and decides top-first vs bottom-first order); #29 forward/back in Overlay rows; #30 Label controls in Overlay rows, Scene title in the `SceneEditor` heading; #31 fades on the unchanged `is-hidden` canvas style.
- The image picker stays as a keyboard way to place, with "Ajouter en superposition".
- Playwright `dragTo` works in Electron (`tests/app/placing.spec.ts`).
