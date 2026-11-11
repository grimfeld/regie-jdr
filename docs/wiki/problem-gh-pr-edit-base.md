# Recurring problem: `gh pr edit --base` fails silently-ish

- 2026-11-12: merging the stacked milestone PRs, `gh pr edit <n> --base main` failed with "GraphQL: Projects (classic) is being deprecated … (repository.pullRequest.projectCards)" on stderr. The loop's `set -e` did not stop because the merge step still ran, so #75, #76 and #77 merged into their stacked bases (`m1-visual-mvp`, `m2-audio-mvp`, `m3-transitions-closeout`), not `main`, and their `Closes` keywords did nothing.
- Repair 2026-11-12: one PR #78 from `m3-transitions-closeout` (which then held M2+M3+M4, tree identical to the CI-tested M4 head) into `main`, closing #33–#72 except #44 and #57.
- How to apply: change a PR's base with the REST API, `gh api -X PATCH repos/grimfeld/regie-jdr/pulls/<n> -f base=main`, and verify `baseRefName` before merging. Prefer GitHub's own retarget (merge with `--delete-branch`, which retargets dependent PRs) for stacks.
