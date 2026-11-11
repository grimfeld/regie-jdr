# Goal: Milestones 1 to 4 as four PRs

On 2026-11-10 the user asked to implement specs #21 (M1 Visual MVP), #33 (M2 Audio MVP), #45 (M3 Scene transitions & MVP closeout) and #58 (M4 Campaign management, Themes & QoL). The end state is one PR per spec, each waiting for the user's review.

- Starting point: `grimfeld/regie-jdr@5b2f613` (main, Milestone 0 merged in PR #20).
- Each spec is split into slice issues (M1 #22 to #32, M2 #34 to #44, M3 #46 to #57, M4 #59 to #72).
- `ready-for-human` slices are not done by agents: #44 (Discord audio acceptance) and #57 (MVP mock session). The PRs say so and leave them open.
- Shape agreed on 2026-11-10: see [Stacked milestone PRs](decision-stacked-milestone-prs.md).

## Progress

- 2026-11-10: branch `m1-visual-mvp` created from `5b2f613`. Wiki seeded.
- 2026-11-11: M1 complete at `m1-visual-mvp@7fefec6`. M2 started early from `3172de1`.
- 2026-11-11: M1 PR opened as #74 (CI green). Merged forward into M2 at `6a66ecd`; wiki home moves to the M2 branch.
- 2026-11-12: M2 PR opened as #75, stacked on #74 (base `m1-visual-mvp`).
- 2026-11-12: M4 PR opened as #77, stacked on #76. All four PRs open: #74 (M1 → main), #75 (M2 → m1), #76 (M3 → m2), #77 (M4 → m3). Goal reached pending CI on #77 and the user's review. Left open for the user: #44 (Discord audio acceptance), #57 (MVP mock session).
- 2026-11-12: M3 PR opened as #76, stacked on #75 (base `m2-audio-mvp`).
- 2026-11-12: user said "Merge them". #74 merged into main (`53f1f5b`); #75–#77 merged into their stacked bases by mistake (see [problem](problem-gh-pr-edit-base.md)); repair PR #78 opened from `m3-transitions-closeout` into main.
- 2026-11-12: repair PR #78 merged (`d3c6858`): `main` matches the CI-tested M4 head; #21–#72 closed except #44 and #57. Goal reached. Next: user asked to delete the milestone branches and release v0.1.0 (Windows installer).
- 2026-11-12: three wiki commits had been left off `main` (two committed in the M3 checkout after the wiki home moved to M4, plus the retarget note); landed via a wiki-only PR.
