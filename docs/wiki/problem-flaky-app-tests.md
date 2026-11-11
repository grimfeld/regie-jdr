# Recurring problem: flaky whole-app tests

- 2026-11-11 (#27): `tests/app/placing.spec.ts:202` failed once. Cause: list row order changed under a click after #28; fixed by #29's wait. Closeout confirmed 20/20.
- 2026-11-11 (#34): `tests/app/placing.spec.ts:153` (Overlay drag-to-list) fails ~2 in 10 on `3172de1`. Closeout's 20/20 suggests it shows under CPU load (several agents run `test:app` at once). Sent to the M1 review-fix agent.
- 2026-11-11 (closeout): 2 Playwright workers → Electron "failed to install correctly". Config uses 1 worker.
- Pattern: placement tests act on lists whose order or contents change asynchronously. Waits must target the expected end state (row with that name), never an index.
