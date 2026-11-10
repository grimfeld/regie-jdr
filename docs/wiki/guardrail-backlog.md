# Guardrail backlog

Cheap guardrails proposed but not yet built. Source: guardrails agent report, 2026-11-10.

- Unit test: the on-air snapshot sent to the Broadcast window never carries Notes or Hidden placements. Partly owned by #22's acceptance criteria; check after #22 merges.
- Test: every channel's sender rule matches the read-only Broadcast bridge.
- Lint: every `eslint-disable` needs a `-- reason` (eslint-comments `require-description`).
- Test: no hard-coded English UI text in `src/`.
- Turn on `noUncheckedIndexedAccess` (many edits as of `35a7e55`).

Plan (2026-11-10): one small guardrail slice after #22 merges, for the first four items.
