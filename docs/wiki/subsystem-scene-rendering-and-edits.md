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

## Labels and Scene title (#30, 2026-11-11, `d9156b8`)

- `SceneEdit`s `set-title`, `set-label-text`, `set-label-visible`. New Label starts Hidden; clearing its text removes it; a Label needs text to be shown. Limits: Label 60 chars, Scene title 100, trimmed.
- UI in `src/PlayerTextFields.tsx`; `LabelControls` is a child of each Overlay row.
- Convention set here: text fields commit on Enter or blur (Escape restores), so one change = one `SceneEdit` = one undo step. The editor's instant preview calls the core's `applySceneEdit` instead of copying logic.

## Background stack and fit (#28, 2026-11-11, `984374f`)

- `SceneEdit`s `move-background`, `set-background-fit`, `frame-background`. Zoom limits 1 to 4 (`MIN_ZOOM`/`MAX_ZOOM`/`clampZoom` in `core/canvas.ts`). Controls in `src/BackgroundControls.tsx`.
- Contain ignores zoom and focal point (whole image always shows); Cover framing is kept for a switch back.
- Convention set here: an edit that adjusts several fields changes only the fields it is given. Whole-object edits made two quick edits undo each other (caught by a whole-app test).
- Sliders send one edit on release (one undo step). Gap: the editor redraws only on release, not during the drag.
- 2026-11-11 decision: placement lists show the top of the stack first. #29 asked to switch the Overlay list to match.

## Overlay transforms and live drag (#29, 2026-11-11, `d733c25`)

- Supersedes the #26 note above: as of `d733c25` both placement lists show the top/front of the stack first.
- `SceneEdit`s `transform-overlay` (partial: x, y, height, each only when given) and `move-overlay {toIndex}`.
- Live drag: Control-only channel `scenes:show-transient` → `OnAirCommands.showTransientEdit`. Applies the edit to the saved Scene and puts it on air only if Active; saves nothing. Same queue as `editScene`, so a transient update never lands after the commit.
- Undo granularity: `src/useOverlayTransforms.ts` sends one committed `transform-overlay` per gesture (pointer release, or 500 ms after the last nudge, or blur/editor close). Transient updates never touch `editScene`, so #32's history gets one step per gesture.
- `src/transientUpdates.ts`: at most one update per animation frame, none while one is in flight, latest only (unit-tested).
- `SceneCanvas` has an optional `editing` prop; the Broadcast window never gets handlers.

## Fades (#31, 2026-11-11, `bbd3ac7`)

- `Settings.fadeDurationMs` (default 600, 0 to 3000; settings schema 2 with migration), saved over Control-only `settings:set-fade-duration`; UI "Fondus" number field in seconds under the On-air monitor (no slider: `smoke.spec` forbids sliders on the Campaign screen).
- The Broadcast window reads no Settings, so the duration travels in `OnAirState.fadeDurationMs` (allow-list updated).
- All fade timing in renderer-safe `core/fades.ts`.
- Fade-out on broadcast: `SceneCanvas` keeps drawing a removed item from the last picture at its stack place and drops it after the fade (`withLeaving`). Images stay transparent until `img.decode()` resolves. Labels and Scene title cross-fade on change; Blackout fades both ways. Fading-out Overlays ignore pointer input.
- Side effect: Activating another Scene dissolves over the fade duration. See [carry-forward](carry-forward.md).

## Undo and redo (#32, 2026-11-11, `a5c4533`)

- History in `core/undoHistory.ts`, recorded inside `editScene`. Each step is a whole-Scene snapshot with a French label (e.g. "masquer Orc"). Control-only channels `scenes:undo-state`, `scenes:undo`, `scenes:redo`.
- Deleting Media clears the history of every Scene it touched.
- If the saved Scene no longer matches the step, undo is refused in French and that Scene's history cleared. **Rule for every later milestone: any new Scene field (Music, Ambiences, Notes, Transition, Chapter) must change through a `SceneEdit` in `editScene`, or undo breaks.**
- Moves of the same Overlay within 1 s merge into one step (nudge bursts; also two quick drags).
- Shared typing check: `isTypingIn` and `editShortcutOf` in `src/keyboard.ts`.

## Running order (#46, 2026-11-12, `m3-transitions-closeout@1a54d3e`)

- Decision: reordering Scenes is a Campaign-level command (`scenes:move`, `SceneLibrary.move`), not a `SceneEdit`, so it never touches Scene undo history. The `editScene` rule covers Scene fields only.
- The running order is the order of Scenes in `scenes.json`; new Scenes go last. No schema change (stays v3).
- `core/runningOrder.ts` (renderer-safe): `moveInRunningOrder`, pure `sceneNextTo(order, from, 'next'|'previous')` (nothing on air → first Scene; no wrap). #56 calls it; #70 Chapters group over the same list.
- UI: Scene list moved to `src/SceneList.tsx`; drag a row onto another to take its place. Gap: no keyboard reorder.

## Duplicate a Scene (#47, 2026-11-12, `3814149`)

- Campaign-level command `scenes:duplicate` (`SceneLibrary.duplicate`), run through `OnAirCommands.duplicateScene` only to join the queue (Notes typed just before are included; no on-air or audio change).
- `copyOfScene` (`core/scenes.ts`) deep-clones, new Scene/Background/Overlay ids, same Media references (incl. Notes images: no file copied). Name "<name> (copie)", original shortened at the 100-char limit. Placed per the issue; "Dupliquer" sits next to Renommer.
- Copy starts with an empty undo history (histories are per Scene id).
- Guard: `sceneFieldInCopy` in `tests/unit/scenes.test.ts` (`satisfies Record<keyof Scene, …>`) plus a no-shared-object walk. A new Scene field fails typecheck there until its copy rule is decided.

## Crossfade on Activate (#48, 2026-11-12, `5258baf`)

- Supersedes #31's "Activating another Scene dissolves over the fade duration".
- `OnAirState.transition` {id, kind, from, to, startedAt, durationMs} goes on air (Scene ids and timing only; allow-list updated); cleared on Campaign open/switch/close.
- `ACTIVATE_DURATION_MS` (1.5 s, `core/fades.ts`) drives both the picture Crossfade and `AUDIO_FADE_MS.activate`.
- Renderer: each on-air picture is a layer on black; the incoming layer waits for image decode, then dissolves. Shared Backgrounds and the Scene title don't flicker; Blackout stays on top. Activate mid-transition freezes the dissolve where it is. Editor fades unchanged.
- No Transition field on Scene yet. #49: add it (duplicate copies it; it never goes on air) and pass `kind: 'cut'`, `durationMs: 0` from `activateScene` in `core/onAir.ts`; renderer needs no change. #50: replace `ACTIVATE_DURATION_MS` where `core/onAir.ts` and `AUDIO_FADE_MS.activate` read it; carry it like `setFadeDuration`.

## Cut and forced Cut (#49, 2026-11-12, `d30b310`)

- Supersedes the #48 note "No Transition field on Scene yet". `Scene.transition` (`'crossfade' | 'cut'`, new Scenes Crossfade) changes only through `SceneEdit` `set-transition` (undo label "régler la transition sur Cut"). Never on air (allow-list `null`); duplicate copies it. `scenes.json` schema 4: migration from 3 sets Crossfade.
- One rule for what Activate starts: `transitionOnActivate(scene, {forceCut})` in `core/onAir.ts`. `OnAir.activateScene(id, scene, kind)` puts a Cut on air as `{kind: 'cut', durationMs: 0}`; the renderer still waits for image decode, then shows it with no dissolve.
- Audio: `AudioOnAir.activateScene(..., kind)` fades over `AUDIO_FADE_MS.cut` (100 ms) on a Cut, `activate` otherwise. #50 replaces only the Crossfade duration.
- Channel `onAir:activate-scene` takes optional `forceCut`; bridge `activateScene(sceneId, {forceCut})`.
- UI: "TRANSITION" menu under the Scene title (`src/SceneTransitionField.tsx`). Shift+click on Activer forces a Cut (`title` hint). `src/activate.ts`: `activateScene(control, sceneId, options)` + `activateOptionsOf(press)` (Shift = forced Cut). #56 shortcuts call these two with their KeyboardEvent.

## Activate and Music crossfade durations (#50, 2026-11-12, `4d2d082`)

- Settings schema 4: `activateDurationMs` (default 1500, 0.1–5 s) and `musicCrossfadeMs` (default 2000, 0.1–10 s); bounds are the agent's choice (0.1 s minimum avoids clicks). Control-only `settings:set-activate-duration`, `settings:set-music-crossfade`. Not on air (the Transition carries `durationMs`).
- `OnAirCommands.setPlayDurations` sets picture and audio together (startup and both channels). `audioFadeMs(change, durations)` replaces `AUDIO_FADE_MS.activate`/`crossfade`; `ACTIVATE_DURATION_MS` is `{default, min, max}`. Cut stays 0 ms picture / 100 ms audio.
- UI: "Durée d’activation" and "Fondu entre musiques" number fields (seconds) under "Fondus".

## Chapters (#70, 2026-11-12, `m4-campaign-themes-qol@ff0a117`)

- `scenes.json` v5 adds `chapters [{id, name, collapsed, sceneIds}]`; Scenes stored in running order (each Chapter's Scenes, then unchaptered). 4→5 migration: no Chapters. Export/Import carry them; Import refuses unreadable Chapters.
- Chapter is not a Scene field: Scene undo, broadcast allow-list and duplicate guard unchanged. All Chapter changes via `scenes:edit-running-order` (never an undo step); read via `scenes:running-order`. Supersedes #46's `scenes:move` / `moveScene` (now a `move-scene` command naming the target Chapter). `scenes:create` takes the Selected Scene id.
- Rules: deleting a Chapter makes its Scenes the first unchaptered Scenes; new Scene goes last in the Selected Scene's Chapter; duplicate right after its source in the same Chapter; Ctrl+↓/↑ walk every Scene incl. collapsed Chapters ("Active" shown on a collapsed heading); Alt+↑/↓ at a group edge enters the next visible group and skips collapsed Chapters; on a Chapter heading Alt+↑/↓ move the Chapter. Unchaptered Scenes always come after all Chapters (simplification).
- UI: "Nouveau chapitre" button opens the form (a permanent form pushed the canvas down and broke `undo.spec`).
- Watch: a move is shown at once and the saved answer is ignored (to fix a race under load). If the save fails, the list could disagree with disk: ask the M4 review to check.
