# Slice agent brief

How one agent implements one slice issue. Written 2026-11-10. If a step here turns out wrong, report it so this page gets a dated correction.

Integration checkout (MAIN below): the checkout that holds your milestone branch. Never edit files in MAIN.

| Milestone branch | MAIN (from 2026-11-11) |
|---|---|
| `m1-visual-mvp` | `F:/WORKPLACE/DEV/regie-jdr-prototype-0.2-windows11/regie-jdr` |
| `m2-audio-mvp` | `F:/WORKPLACE/DEV/regie-jdr-prototype-0.2-windows11/regie-jdr/.claude/worktrees/m2-integration` |
| `m3-transitions-closeout` | `F:/WORKPLACE/DEV/regie-jdr-prototype-0.2-windows11/regie-jdr/.claude/worktrees/m3-integration` (from 2026-11-12) |
| `m4-campaign-themes-qol` | `F:/WORKPLACE/DEV/regie-jdr-prototype-0.2-windows11/regie-jdr/.claude/worktrees/m4-integration` (from 2026-11-12) |

Wiki home: from 2026-11-12 (M3 closed as PR #76, merged forward at `m4-campaign-themes-qol@7bf3e5f`) the newest wiki is in the M4 checkout's `docs/wiki/`. Earlier: from 2026-11-12 (M2 closed as PR #75, merged forward at `m3-transitions-closeout@ea75a13`) the newest wiki is in the M3 checkout's `docs/wiki/`. Earlier: from 2026-11-11 (M1 closed as PR #74, merged forward at `m2-audio-mvp@6a66ecd`) the newest wiki is in the M2 checkout's `docs/wiki/`; read it there. Earlier the M1 checkout held it. Create slice worktrees with `git -C MAIN worktree add ...` (paths in step 2 are relative to MAIN of the repo root, `F:/WORKPLACE/DEV/regie-jdr-prototype-0.2-windows11/regie-jdr/.claude/worktrees/<n>`).

## 1. Read first

- `CLAUDE.md`, `GLOSSARY.md`, `docs/agents/domain.md`, the ADRs in `docs/adr/` that touch your area, `CODING_STANDARDS.md` (once it exists).
- Your slice issue and its parent spec: `gh issue view <n> --json title,body,comments`.
- `docs/wiki/index.md` and the milestone log page for your milestone.

## 2. Set up an isolated worktree

```
git -C MAIN worktree add F:/WORKPLACE/DEV/regie-jdr-prototype-0.2-windows11/regie-jdr/.claude/worktrees/<n> -b <prefix>/<n>-<slug> <milestone-branch>
cd F:/WORKPLACE/DEV/regie-jdr-prototype-0.2-windows11/regie-jdr/.claude/worktrees/<n> && npm ci
```

## 3. Build it

- Test-first where there is logic (the `tdd` skill). Core logic gets unit tests; user-visible behaviour gets whole-app Playwright tests, as the acceptance criteria say.
- Use glossary terms in code, tests and commits. UI text is French, as in the existing app.
- Stay inside your slice. If the slice needs something another slice owns, build the smallest piece you need and say so in your report.
- Commits: small, imperative sentence subject, no prefix, a body saying why. End each message with the attribution lines in the parent session's instructions (the brief you were given repeats them).

## 4. Gates (all must pass, none weakened)

`npm run format:check`, `npm run lint` (once it exists), `npm run typecheck`, `npm test`, `npm run build`, `npm run test:app`.

## 5. Integrate

```
git rebase <milestone-branch>        # pick up slices merged meanwhile
# re-run all gates after a rebase that brought in new commits
git -C MAIN merge --ff-only <prefix>/<n>-<slug>
```

Run each step-5 command on its own and check its exit status. Never chain them with `&&` into a pipe (`| tail`, `| head`): the pipe hides a failed fast-forward and the next command removes your worktree anyway (happened on 2026-11-11 during #25; no work lost).

Rebase conflicts are expected in shared lists: `RENDERER_SAFE_CORE` (`eslint.config.mjs` and `CODING_STANDARDS.md`) and the bridge key list in `tests/app/bridges.spec.ts` (seen 2026-11-11). Keep both sides.

If the fast-forward fails, someone merged first: rebase again, re-run gates, retry. Then `git -C MAIN worktree remove .claude/worktrees/<n>` and delete the slice branch.

Do not push, open PRs, comment on or close issues. The chief of staff does that.

## 6. Report (10 lines max)

Merged SHA; gate results; every deviation from the issue's acceptance criteria and why; follow-ups; anything a later agent must know (put the detail in commit messages, not the report).


Correction 2026-11-12 (#36 report): step 2 used a relative path, which put the worktree inside MAIN's own `.claude/worktrees` when MAIN is itself a worktree. Step 2 now gives the absolute repo-root path.

Correction 2026-11-12 (#67 report: three ~7 min gate re-runs caused only by wiki-log commits): after a rebase, re-run the gates only if it brought in changes outside `docs/wiki/`. Check with `git diff --stat <old-base> <new-base> -- . ':!docs/wiki'`; empty output means the code is unchanged and the earlier green gates still hold. Any other change: re-run all six gates before the fast-forward.

Correction 2026-11-12 (#66, #67): save screenshots and other evidence outside the worktree (Playwright wipes `test-results/` at every run, and the worktree is removed at the end): use the scratchpad `shots/` folder named in your prompt.
