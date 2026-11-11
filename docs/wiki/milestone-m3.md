# M3 log (spec #45)

Branch `m3-transitions-closeout`, from `m2-audio-mvp@b545dc4` on 2026-11-12, started before M2 closed. M2 changes are merged forward (merge, not rebase). Integration checkout: `.claude/worktrees/m3-integration`. Wiki home stays on M2 until M2 closes.

Read first: [carry-forward](carry-forward.md) M3 section, ADR-0004 (rich Notes as ProseMirror JSON).

## Planned order (2026-11-12)

1. #51 rich Notes editor (independent of audio), started while M2 finishes.
2. After M2 closes: #48 Crossfade on Activate (tracer), #46 running order, #47 duplicate.
3. #49 Cut and forced Cut, #50 duration settings, #52 Notes images + Reference category.
4. #53 resize Notes images, #54 Notes images as Media uses, #55 last Active Scene (compare with #24 first), #56 Scene shortcuts.
5. #57 is ready-for-human (mock session over Discord): the PR leaves it open.

## Outcomes
- 2026-11-12: #51 rich Notes merged at `30645d0` (785 unit, 133 app tests). See [Notes](subsystem-notes.md). Fixed four position-bound app tests with `dragOnScreen` / `pressAndMove` in `tests/app/harness.ts` (M2 closeout told to copy them).

## Follow-ups to clear before the M3 PR

- A Notes save pending under 500 ms is lost if the app quits then; flush on quit. Source: #51 report.
- Merge-forward from M2: scenes schema versions/migrations may conflict if M2 bumps the scenes schema; harness helpers duplicated with M2 closeout. Source: #51 report.
- 2026-11-12: #46 running order merged at `1a54d3e` (805 unit, 134 app tests). No migration needed (already creation order). Gap: no keyboard reorder.
- 2026-11-12: #52 Notes images merged at `f936525` (851 unit, 140 app tests). `ambiences.spec.ts:116` failed once under load (drag test, see flaky-tests rule).
- 2026-11-12: M2 merged forward into M3 at `ea75a13` (884 unit, 149 app tests). Final schemas: scenes v3, Media index v3, Settings v3, Soundboard v1, campaign v1. Wiki home moves to the M3 branch. M2 CI failure on `background-fit.spec.ts:241` under investigation (passes locally).
- 2026-11-12: #47 duplicate merged at `3814149` (896 unit, 150 app tests). No deviations.
