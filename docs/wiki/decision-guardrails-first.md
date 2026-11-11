# Decision: guardrails before feature work

On 2026-11-10 the user agreed to add ESLint (typescript-eslint, strict rules, CI step) and a `CODING_STANDARDS.md` as the first commits of the M1 PR.

- Why: at `grimfeld/regie-jdr@5b2f613` the only automated gates were Prettier, `tsc -b`, Vitest and Playwright. Nothing told reviewing agents what good code in this repo looks like.
- Rule for every later agent: never weaken a gate to get to green (no new `eslint-disable`, `@ts-ignore`, `.skip`, lowered thresholds) unless `CODING_STANDARDS.md` allows that case.

## Outcome (2026-11-10)

- Landed at `grimfeld/regie-jdr@35a7e55` (ESLint, `npm run lint`, CI Lint step) and `@310598d` (`CODING_STANDARDS.md`, linked from `CLAUDE.md`). Gates green at `35a7e55`: 184 unit, 56 whole-app tests.
- As of `35a7e55`, lint enforces layer boundaries: core/ and shared/ never import electron or react; shared/ is types only; preloads load only `electron`; renderer windows load only Node-free core modules. Scoped exceptions are commented in `eslint.config.mjs`.
- Deferred guardrails: see [Guardrail backlog](guardrail-backlog.md).
