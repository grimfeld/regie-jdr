# Recurring problem: session interrupted mid-work

- 2026-11-12: the PC crashed while three agents ran (M3 review fixes, M4 #62, M4 #69). After restart: no git locks, all integration checkouts clean, slice worktrees intact (#62 had a commit). All three resumed with SendMessage; none restarted from scratch.
- Same recovery as [usage-limit stops](problem-usage-limit.md). Checklist after any interruption: look for `.git/*.lock`, run `git worktree list` and `git status` in every integration checkout, then resume each agent and tell it its worktree state and to re-run gates (an interrupted test run proves nothing).
- Why the design survived: integration only moves by fast-forward after green gates, so an interrupted agent never leaves a milestone branch half-merged.
