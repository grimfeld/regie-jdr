# M1 log (spec #21)

Branch `m1-visual-mvp`, from `5b2f613` on 2026-11-10.

## Planned order (2026-11-10)

Slice issues carry no "Blocked by" lines, so the chief of staff ordered them by what each renders through:

1. Guardrails (ESLint, CODING_STANDARDS.md) and #22 shared renderer, in parallel.
2. #24 Scene list and editor, #25 library thumbnails/filter/search, #23 On-air monitor and Blackout.
3. #26 place Media by drag, with show/hide.
4. #27 Explorer drag-import, #28 Background stack and fit, #29 Overlay transforms, #30 Labels and Scene title, #31 fades.
5. #32 undo/redo last, since it wraps every Scene edit command.

## Outcomes

- 2026-11-10: guardrails merged at `310598d` ([decision](decision-guardrails-first.md)).
- 2026-11-11: #22 shared renderer merged at `90ddedc` (225 unit, 60 app tests). See [subsystem page](subsystem-scene-rendering-and-edits.md). Went beyond its criteria: schema 2 data shape for all of M1.
- 2026-11-11: #23 On-air monitor and Blackout merged at `caf0d4b` (236 unit, 64 app tests). Shared on-air subscription hook `src/useOnAir.ts`; Control-only channel `onAir:set-blackout`. No deviations.
- 2026-11-11: guardrail backlog slice merged at `8198f81` (252 unit, 64 app tests). See [backlog](guardrail-backlog.md).
- 2026-11-11: #25 library merged at `5cbaeb5` (296 unit, 67 app tests). See [subsystem page](subsystem-media-library.md). Manual 500-image scroll check pending for the PR.
- 2026-11-11: #24 Scene list and editor merged at `4555b1c` (314 unit, 72 app tests). Deviations to list in the PR: badge text "EN DIRECT" replaces "Scène active"; with no last Active Scene, opening a Campaign selects the first Scene; empty editor's "Créer une scène" focuses the name field instead of creating.

## Follow-ups to clear before the M1 PR

- Deleting a Scene leaves its id in Settings `lastActiveSceneByCampaign` (UI ignores it). Source: #24 report, 2026-11-11.
- Manual check: ~500 images scroll smoothly in the library. Source: #25 report.
- `GLOSSARY.md` lacks "broadcast projection". Source: #22 report.
- Flaky test: `tests/app/placing.spec.ts:202` failed once in a full run (likely race between placing twice and show/hide preview). Fix the race; no retries. Source: #27 report.
- Manual check: real drag from Windows Explorer. Source: #27 report.
- Background slider shows framing only on release, not during drag. Source: #28 report.
- Test PNG generator duplicated (`tests/app/background-fit.spec.ts`, `library.spec.ts` `picturePng`); move to `tests/app/harness.ts`. Source: #28 report.
- 2026-11-11: #26 placing Media merged at `b8a3580` (325 unit, 77 app tests). Kept the image picker for keyboard users.
- Follow-up (from #26): `GLOSSARY.md` has no French UI term for Overlay; "Superpositions" / "Ajouter en superposition" are working labels. User decision.
  - 2026-11-11: user decided "Superposition" is the French UI term for Overlay. Closeout adds it to `GLOSSARY.md`.
- 2026-11-11: #30 Labels and Scene title merged at `d9156b8` (343 unit, 80 app tests). No deviations.
- 2026-11-11: #28 Background stack and fit merged at `984374f` (366 unit, 83 app tests). No deviations. List order now top-first.
- 2026-11-11: #27 Explorer drag-import merged at `a65b466` (379 unit, 87 app tests). See [library page](subsystem-media-library.md).
- 2026-11-11: #29 Overlay transforms merged at `d733c25` (417 unit, 91 app tests). No deviations. Made `placing.spec.ts` wait for both Overlay rows (timing fix); check whether that was the flaky line 202.
