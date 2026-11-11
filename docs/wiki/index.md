# Chief-of-staff wiki

Memory for the agents delivering milestone work. It is a historical record: every claim is dated or tied to a commit. Read this index first, then only the pages you need.

## Goals

- [Goal: Milestones 1 to 4 as four PRs](goal-m1-m4-prs.md): what was asked on 2026-11-10 and how far it got.

## Decisions

- [Stacked milestone PRs](decision-stacked-milestone-prs.md): one integration branch and one PR per milestone, each based on the one before.
- [Guardrails before feature work](decision-guardrails-first.md): ESLint and CODING_STANDARDS.md land first in the M1 PR.
- [Guardrail backlog](guardrail-backlog.md): proposed guardrails not yet built.

## Subsystems

- [Scene rendering and Scene edits](subsystem-scene-rendering-and-edits.md): shared renderer, broadcast projection, how to add a SceneEdit.

- [Audio engine and mix](subsystem-audio.md): where audio plays, the pure mix, plug-in points for #36 to #43.
- [Media library](subsystem-media-library.md): thumbnails, search, rename, WebP caveat.

## Recurring problems

- [Piped merge hides a failed fast-forward](problem-piped-merge-hides-failure.md)
- [Flaky whole-app tests](problem-flaky-app-tests.md)

## Process

- [Slice agent brief](slice-agent-brief.md): how an agent implements one slice issue and merges it into its milestone branch. Every slice agent reads this.

## Reviews

- [M1 review 2026-11-11](review-m1-2026-11-11.md): 3 should-fix, 7 notes.

## Milestone logs

- [M1 log](milestone-m1.md): slice order and outcomes for #21.
- [M2 log](milestone-m2.md): slice order and outcomes for #33.

## Cross-milestone

- [Carry-forward](carry-forward.md): facts from one milestone that later milestones need.

## User preferences

- [Game Master's working preferences](user-preferences.md)
