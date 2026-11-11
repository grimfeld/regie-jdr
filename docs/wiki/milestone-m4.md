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
