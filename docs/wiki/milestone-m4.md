# M4 log (spec #58)

Branch `m4-campaign-themes-qol`, from `m3-transitions-closeout@16e5e3c`+wiki on 2026-11-12, started before M3 closed. M3 changes are merged forward (merge, not rebase). Integration checkout: `.claude/worktrees/m4-integration`. Wiki home stays on M3 until M3 closes.

Read first: ADR-0005 (Campaign export as plain zip), [carry-forward](carry-forward.md) M4 section, `docs/audit/v0.2-audit.md` (theme and C-01/C-03 design reviews).

## Planned order (2026-11-12)

1. #59 delete Campaign to the Recycle Bin (independent of M3), started while M3 finishes.
2. #60 Export tracer, then #61 Import, #62 drop zip, #63 progress/cancel.
3. #64 theme prefactor (tokens, contrast test, raw-colour test), then #65 picker, #66–#68 themes.
4. #69 favourites, #72 always on top; #70 Chapters and #71 remapping after M3's #46/#56 are merged forward.

## Outcomes
- 2026-11-12: #59 delete Campaign merged at `7b57fe0` (962 unit, 160 app tests). No deviations. See [Campaign management](subsystem-campaign-management.md).
- 2026-11-12: #60 Export merged at `9bbfa9a` (986 unit, 162 app tests). See [Campaign management](subsystem-campaign-management.md).
- 2026-11-12: #61 Import merged at `ff3bb76` (1137 unit, 167 app tests). See [Campaign management](subsystem-campaign-management.md).
- 2026-11-12: #64 theme prefactor merged at `c4a2ec0` (1253 unit, 167 app tests). See [themes](subsystem-themes.md).
- 2026-11-12: #62 drop zip merged at `8178fda` (1262 unit, 171 app tests), gates re-run after the PC crash. No deviations.
- 2026-11-12: #69 favourites merged at `a3682ae` (1279 unit, 172 app tests). No deviations.
- 2026-11-12: #63 progress/cancel merged at `012c48c` (1291 unit, 174 app tests).

## Follow-ups to clear before the M4 PR

- (Done 2026-11-12, `2491f70`.) The three "Fondus" duration fields render as light, unthemed boxes (seen in `imperium-campaign-after.png`, 2026-11-12); they became text fields in M3 closeout and likely lost the input styling. Check all three themes; add a test that every text field uses themed tokens. Source: chief of staff screenshot review.
- Manual check: Broadcast always on top on one monitor while sharing in Discord. Source: #72.

- `.campaign-badge` (from #61) uses `var(--accent2)`, not a theme token; the raw-colour test missed it. Use a token and make the test catch unknown `var(--…)` names. Source: #63 report.
- Manual check: Export/Import of a multi-gigabyte real Campaign with progress and Cancel. Source: #63 report.
- 2026-11-12: M3 merged forward at `7bf3e5f` (real merges `0a86ca2`, `5b9b63d`, `7bf3e5f`; 193 app tests). Final schemas: scenes 4, Settings 5 (3→4 M3 durations, 4→5 always on top; dev-only M4 v4 files handled), Media index 4, campaign 1, soundboard 1. Import accepts every migratable version; refuses a `scenes.json` with unreadable Notes as damaged. Wiki home moves to the M4 branch.
- 2026-11-12: #66 Rétro SF merged at `6521557` (1392 unit, 196 app tests).
- 2026-11-12: #68 Fantasy merged at `73e7ea8` (1392 unit, 199 app tests).
- 2026-11-12: #67 Imperium merged at `870eec4` (201 app tests). All three themes done.
- 2026-11-12: #70 Chapters merged at `ff0a117` (1426 unit, 204 app tests).
- 2026-11-12: #71 remapping merged at `e4c0257` (1471 unit, 206 app tests). Every M4 agent slice done; closeout and review running.
- 2026-11-12: M4 closeout merged at `2491f70` (1480 unit, 214 app tests). Fields: one zero-specificity base rule in `src/styles.css` themes every field (Fondus, Scene title, Label, Transition were system grey); `tests/app/theme-fields.spec.ts` checks every visible field in all three themes. Top bar fits at 1080 px with ~60 px spare (`tests/app/topbar.spec.ts`). Chapters: `src/optimisticSaves.ts` shows one French notice per failure burst and re-reads the saved order once in-flight moves settle. Import refuses with sizes in French when free space (`fs.statfs`) is short.
- 2026-11-12: M4 review fixes merged at `b171400`. M4 complete; PR next.
- (Done 2026-11-12, #65 `ddf905b`.) `.campaign-badge` (from #61) uses `var(--accent2)`, not a theme token; the raw-colour test missed it. Use a token and make the test catch unknown `var(--…)` names. Source: #63 report.
- 2026-11-12: #72 always on top merged at `515ece4` (1295 unit, 176 app tests). "Toujours au premier plan" in the Control top bar; Settings v4 `broadcastAlwaysOnTop` (collides with M3's Settings v4: merge-forward agent told to chain v4→v5); Control-only `settings:set-broadcast-always-on-top`. Manual check: single monitor while sharing in Discord. Open: top bar layout at the 1080 px minimum width.
- 2026-11-12: M3 PR opened as #76 (stacked on #75). M3 merge-forward into M4 in progress.
- 2026-11-12: #65 theme picker merged at `ddf905b` (1298 unit, 177 app tests).
