# Slice agent brief

How one agent implements one slice issue. Written 2026-11-10. If a step here turns out wrong, report it so this page gets a dated correction.

Integration checkout (MAIN below): the checkout that holds your milestone branch. Never edit files in MAIN.

| Milestone branch | MAIN (from 2026-11-11) |
|---|---|
| `m1-visual-mvp` | `F:/WORKPLACE/DEV/regie-jdr-prototype-0.2-windows11/regie-jdr` |
| `m2-audio-mvp` | `F:/WORKPLACE/DEV/regie-jdr-prototype-0.2-windows11/regie-jdr/.claude/worktrees/m2-integration` |

Wiki home: from 2026-11-11 (M1 closed as PR #74, merged forward at `m2-audio-mvp@6a66ecd`) the newest wiki is in the M2 checkout's `docs/wiki/`; read it there. Earlier the M1 checkout held it. Create slice worktrees with `git -C MAIN worktree add ...` (paths in step 2 are relative to MAIN of the repo root, `F:/WORKPLACE/DEV/regie-jdr-prototype-0.2-windows11/regie-jdr/.claude/worktrees/<n>`).

## 1. Read first

- `CLAUDE.md`, `GLOSSARY.md`, `docs/agents/domain.md`, the ADRs in `docs/adr/` that touch your area, `CODING_STANDARDS.md` (once it exists).
- Your slice issue and its parent spec: `gh issue view <n> --json title,body,comments`.
- `docs/wiki/index.md` and the milestone log page for your milestone.

## 2. Set up an isolated worktree

```
git -C MAIN worktree add .claude/worktrees/<n> -b <prefix>/<n>-<slug> <milestone-branch>
cd MAIN/.claude/worktrees/<n> && npm ci
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
