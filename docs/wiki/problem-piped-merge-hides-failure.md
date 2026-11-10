# Recurring problem: piped merge hides a failed fast-forward

- 2026-11-11, #25 and #24 agents, independently: `git merge --ff-only ... | tail` inside an `&&` chain. The pipe's exit status was `tail`'s, so the failed fast-forward looked like success and the next command removed the worktree. Branches survived; no work lost.
- Fix 2026-11-11: [slice agent brief](slice-agent-brief.md) step 5 now says run each command alone and check its exit status. If it happens again, make the brief's step 5 a script (`scripts/`) instead of prose.
