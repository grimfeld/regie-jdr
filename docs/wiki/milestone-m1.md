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
