# Shipping

How work gets from a branch to main in this repository. Written by `/ship:setup-ship`; the
`ship` plugin's skills (`pr-review`, `night-shift`) read it. Keep it true when the process changes.

## The rule

A PR reaches `main` only after a person has reviewed it and added the **`ship`** label.
Nothing else merges: the `ship` commit status is required by the ruleset on `main`, and it stays
pending until the label is on.

1. An agent opens the PR as a **draft** while it works.
2. It marks the PR ready only when local checks pass, `/ship:pr-review` has run (label `pr-reviewed`) and the
   review section is in the description.
3. You read the review section, and add `ship` or leave a comment.
4. `.github/workflows/ship.yml` lands it: GitHub auto-merge merges it with a merge commit once `check` and `ship` are green.

Dependabot patch updates and GitHub Actions updates get `ship` without review.

## Landing

- **Mode:** auto-merge
- **Merge method:** merge (a merge commit per PR, as in the existing history)

Merged by GitHub auto-merge when the required checks pass.

## Conflicts

A labelled PR that conflicts with `main` can't land: a landing run would skip it again and again.
The `conflicts` job in `ship.yml` checks the labelled PRs each time `main` moves, and when a PR gets `ship`.
For each one that conflicts, it removes `ship`, adds **`conflicts`**, and comments with the conflicting files.

`/ship:resolve-conflicts [<pr>...]` merges `main` into each such PR, keeping what both sides meant, runs
the local checks and pushes. Then:

- **Only bookkeeping files conflicted:** `ship` goes back on, and the PR lands with the next run.
- **Anything else conflicted:** the resolution is new code. `/ship:pr-review` runs on it and a comment explains each
  choice; re-review it and add `ship` again.
- **The two sides contradict each other:** nothing is pushed, `conflicts` stays, and a comment names the decision to make.

Resolving it yourself works too: merge `main` into the branch, push, remove `conflicts` and add `ship`.

Bookkeeping files (a conflict here needs no re-review):

- `docs/wiki/index.md`

## Checks

Required on `main`: `check` (CI: formatting, lint, typecheck, unit tests, production build, whole-app tests), and `ship`.

Run locally before marking a PR ready: `npm run format:check && npm run lint && npm run typecheck && npm test && npm run build && npm run test:app`

## After merge

Nothing deploys on merge. Pushing a `v*.*.*` version tag runs `.github/workflows/release.yml`, which publishes the Windows installers (`.exe`, `.msi`) as a GitHub Release.

## Screens

Command that produces screenshots of the screens a change touches, for the review section: none

## Spec labels

Specs are GitHub issues moving through `spec:draft` → `spec:ready` → `spec:building` → `spec:in-review`, or
`spec:stuck`, and close when their PR ships.

## Design labels

A design is a GitHub issue carrying a Claude Design artifact link. Label it `design:ready` when the design is
settled; `/ship:design-me` turns it into specs and relabels it `design:specced`. Its handoffs are committed under
`docs/design/<module>/` by the PRs that build them. To revise a design, relabel its issue `design:ready`.
