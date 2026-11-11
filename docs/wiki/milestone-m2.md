# M2 log (spec #33)

Branch `m2-audio-mvp`, from `m1-visual-mvp@3172de1` on 2026-11-11, started before M1 closed so overnight time is used. M1 fixes are merged forward into it (merge, not rebase). Integration checkout: `.claude/worktrees/m2-integration`.

Read first: ADR-0002 (audio plays in the Control window; Discord carries all app audio), [carry-forward](carry-forward.md) M2 section (Scene audio changes go through `SceneEdit`s; shared typing check `isTypingIn`).

## Planned order (2026-11-11)

1. #34 audio library (roles, duration, filter, search, rename) and #35 tracer bullet (Scene Music plays on Activate through the audio engine, Master volume), in parallel.
2. #36 Music controls, #37 Ambiences, #39 Soundboard.
3. #38 Activate fades and continuity, #40 Silence, #42 missing audio.
4. #41 pad and Silence shortcuts, #43 private listening.
5. #44 is ready-for-human: the PR leaves it open.

## Outcomes
- 2026-11-11: #34 audio library merged at `398a0dd` (547 unit, 101 app tests). See [library page](subsystem-media-library.md).
- 2026-11-11: #35 tracer merged at `956ba64` (594 unit, 106 app tests). See [audio subsystem](subsystem-audio.md). Smoke test now expects one slider, "Volume général".

## Follow-ups to clear before the M2 PR

- Two sounds dropped back to back: the second was lost; (2026-11-11: maybe the layout shift found in [flaky tests](problem-flaky-app-tests.md)); #35's app test waits between drops instead. Likely a real bug (role dialog or drop handler). Fix the cause, then remove the wait. Source: #35 report.
- `GLOSSARY.md` lacks "mix" and "voice". Source: #35 report.
- Manual check: no clicks on volume ramps. Source: #35 report.
- Deleting a Media silently removes its Soundboard pads; M0 #15 warns for Scene uses. Decide per spec #33 whether pads count as uses. Source: #39 report.
- Manual check: 8 pads at once over Music and Ambiences. Source: #39 report.
- Pressing a pad whose file is missing gives no notice. Source: #42 report.
- Live audio while dragging Ambience and pad volume sliders; unify `VolumeSlider` (#37) with `LevelSlider` (#36). Source: #37 report.
- Make `overlay-transforms.spec` and `placing.spec` position-independent; both the Music and Ambience level sliders were squeezed onto heading lines to dodge them. Source: #37 report.
- 2026-11-11: M1 (PR #74, CI green) merged forward into `m2-audio-mvp` at `6a66ecd` (real merge; 603 unit, 109 app tests). Undo refusal now covers Music and Ambiences; notice reads "Un média de cette étape a été supprimé".
- Follow-up: unit test for undo refused when a restored Music was deleted. Source: merge-forward report.
- 2026-11-12: #37 Ambiences merged at `4e88616` (630 unit, 112 app tests).
- 2026-11-12: #39 Soundboard merged at `6b99c61` (674 unit, 114 app tests). Smoke test now expects 2 sliders.
- 2026-11-12: #36 Music controls merged at `5a330db` (708 unit, 118 app tests).
- 2026-11-12: #42 missing audio merged at `13a1384` (717 unit, 122 app tests). No deviations.
- 2026-11-12: #40 Silence merged at `310287b` (733 unit, 124 app tests).
- 2026-11-12: M1 fix `9a0c2ab` (framing slider after undo) merged forward, clean merge; gates run by the next slice.
