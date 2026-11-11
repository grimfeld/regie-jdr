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
- 2026-11-11: M1 (PR #74, CI green) merged forward into `m2-audio-mvp` at `6a66ecd` (real merge; 603 unit, 109 app tests). Undo refusal now covers Music and Ambiences; notice reads "Un média de cette étape a été supprimé".
- Follow-up: unit test for undo refused when a restored Music was deleted. Source: merge-forward report.
