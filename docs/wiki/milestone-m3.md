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

- Number fields refuse a French decimal comma ("4,5"); #50's test switched to "4.5". A French Game Master types a comma: accept both in "Fondus", "Durée d’activation", "Fondu entre musiques". Source: #50 report.
- Run the full app suite (#50 merged with only `fades.spec` re-run). Source: #50 report.
- Manual check: long Activate and Music crossfade sound right; 0.1 s Cut audio does not click.

- Notes editor restarts (losing Notes undo) after any Media delete touching Notes, even when the open Scene was untouched; restart only when the open Scene changed. Source: #54 report.

- A Notes save pending under 500 ms is lost if the app quits then; flush on quit. Source: #51 report.
- Merge-forward from M2: scenes schema versions/migrations may conflict if M2 bumps the scenes schema; harness helpers duplicated with M2 closeout. Source: #51 report.
- 2026-11-12: #46 running order merged at `1a54d3e` (805 unit, 134 app tests). No migration needed (already creation order). Gap: no keyboard reorder.
- 2026-11-12: #52 Notes images merged at `f936525` (851 unit, 140 app tests). `ambiences.spec.ts:116` failed once under load (drag test, see flaky-tests rule).
- 2026-11-12: M2 merged forward into M3 at `ea75a13` (884 unit, 149 app tests). Final schemas: scenes v3, Media index v3, Settings v3, Soundboard v1, campaign v1. Wiki home moves to the M3 branch. M2 CI failure on `background-fit.spec.ts:241` under investigation (passes locally).
- 2026-11-12: #47 duplicate merged at `3814149` (896 unit, 150 app tests). No deviations.
- 2026-11-12: #53 Notes image size merged at `828f354` (907 unit, 152 app tests).
- 2026-11-12: #48 Crossfade merged at `5258baf` (930 unit, 155 app tests). Manual check: how the dissolve feels, large-image frames.
- 2026-11-12: M2 CI fixed at `65e6049` (real slider-draft race; see [flaky tests](problem-flaky-app-tests.md)); #75 CI green. Backport to M1 #74 and merge-forward to M3 in progress.
- 2026-11-12: #54 Notes images as uses merged at `6701986` (941 unit, 157 app tests). Gap: Notes undo lost for untouched open Scene after a delete touching other Notes.
- 2026-11-12: slider-draft fix backported to M1 (`7fbc29f`, #74 CI green), merged into M2 (`3f6b9bc`, #75 CI green) and M3 (`16e5e3c`).
- 2026-11-12: #55 merged at `d19af19` (941 unit, 158 app tests): no app change needed, M1 #24 already met it; added a three-Campaign + restart whole-app test (proven to fail when the stored Scene is ignored).
- 2026-11-12: #49 Cut and forced Cut merged at `7924e22` (964 unit, 160 app tests). scenes.json now v4 (Crossfade migration). #56 must call `src/activate.ts`. Manual check: no click on a Cut's 0.1 s audio switch.
- 2026-11-12: #49 Cut merged at `d30b310` (964 unit, 159 app tests). Manual check: 0.1 s audio switch on a Cut does not click.
- 2026-11-12: #50 duration settings merged at `4d2d082` (983 unit tests; full app suite not re-run after its last test change).
