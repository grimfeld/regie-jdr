# Subsystem: themes

## Theme prefactor (#64, 2026-11-12, `m4-campaign-themes-qol@c4a2ec0`)

- Single token list `src/themes/tokens.css` (also the first-frame values); each theme `src/themes/<id>.css` must set every token (enforced by `tests/unit/themeContrast.test.ts`). Canvas colours in `src/themes/unthemed.css`, never set by themes. A theme applies to any element with `data-theme`.
- Guardrails (shown failing first): `tests/unit/rawColours.test.ts` (no raw colours outside theme files; unit test because ESLint doesn't read CSS) and the contrast test. Documented in CODING_STANDARDS.md "Themes".
- Contrast fixes shipped: Imperium/Fantasy primary-button text (`--on-accent`), footer text, failed-sound "illisible", top-bar separator.
- Broadcast window asserted to carry no `data-theme`.
- Hooks: #66–#68 edit only their own theme file (`--texture`, `--frame`, `--font-*`, `--radius*`); #65 sample cards use `data-theme` like the swatches, then delete `--swatch-dark`/`--swatch-light`. New text/surface pairs must be added to the contrast test's lists.
- Left literal: radii 2/3/5/6/8 px; `backgroundColor` in `electron/main.ts` (painted before page load).
