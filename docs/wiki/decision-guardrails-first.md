# Decision: guardrails before feature work

On 2026-11-10 the user agreed to add ESLint (typescript-eslint, strict rules, CI step) and a `CODING_STANDARDS.md` as the first commits of the M1 PR.

- Why: at `grimfeld/regie-jdr@5b2f613` the only automated gates were Prettier, `tsc -b`, Vitest and Playwright. Nothing told reviewing agents what good code in this repo looks like.
- Rule for every later agent: never weaken a gate to get to green (no new `eslint-disable`, `@ts-ignore`, `.skip`, lowered thresholds) unless `CODING_STANDARDS.md` allows that case.
