# Decision: stacked milestone PRs

On 2026-11-10 the user chose stacked PRs over "all target main".

- Integration branches: `m1-visual-mvp` → main, `m2-audio-mvp` → `m1-visual-mvp`, `m3-transitions-closeout` → `m2-audio-mvp`, `m4-campaign-themes-qol` → `m3-transitions-closeout`.
- Each milestone branch starts from the finished previous one, so each PR diff shows only its own milestone.
- Follows the Milestone 0 precedent (PR #20): slice branches merged into one integration branch, one PR that `Closes` every slice it finishes plus the spec.
- Consequence: the user reviews and merges in order. If M1 changes in review, later branches must be rebased or merged forward.
- Slice branches are named `<milestone-branch-prefix>/<issue>-<slug>`, e.g. `m1/22-shared-renderer`. They are local only; only milestone branches are pushed.
