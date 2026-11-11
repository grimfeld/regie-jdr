# Subsystem: themes

## Theme prefactor (#64, 2026-11-12, `m4-campaign-themes-qol@c4a2ec0`)

- Single token list `src/themes/tokens.css` (also the first-frame values); each theme `src/themes/<id>.css` must set every token (enforced by `tests/unit/themeContrast.test.ts`). Canvas colours in `src/themes/unthemed.css`, never set by themes. A theme applies to any element with `data-theme`.
- Guardrails (shown failing first): `tests/unit/rawColours.test.ts` (no raw colours outside theme files; unit test because ESLint doesn't read CSS) and the contrast test. Documented in CODING_STANDARDS.md "Themes".
- Contrast fixes shipped: Imperium/Fantasy primary-button text (`--on-accent`), footer text, failed-sound "illisible", top-bar separator.
- Broadcast window asserted to carry no `data-theme`.
- Hooks: #66–#68 edit only their own theme file (`--texture`, `--frame`, `--font-*`, `--radius*`); #65 sample cards use `data-theme` like the swatches, then delete `--swatch-dark`/`--swatch-light`. New text/surface pairs must be added to the contrast test's lists.
- Left literal: radii 2/3/5/6/8 px; `backgroundColor` in `electron/main.ts` (painted before page load).

## Rétro SF (#66, 2026-11-12, `6521557`)

- `src/themes/retro.css`: near-black green page, thin bright green borders, small radii, phosphor glow, static scanlines (`--texture`, page background only), blinking `_` after "RÉGIE JDR" (off under reduced motion). Also sets `color-scheme: dark` and `accent-color`, and styles `.brand strong` (ties the theme to two class names).
- Font: Share Tech Mono (display only), local Latin-subset woff2 in `src/themes/fonts/`, SIL OFL 1.1, from Fontsource 5.3.0; licence text beside it. Body text stays Arial for long reading.
- Assets register `docs/theme-assets.md` with a review checklist; #67/#68 add rows.
- Tests `tests/app/retro-theme.spec.ts` (font loads with no CSP violation; scanlines off panels; cursor stops under reduced motion), failed against the old theme.
- Screenshots live outside worktrees (Playwright wipes `test-results/`): scratchpad `shots/`. Chief of staff looked at `retro-campaign-after.png` on 2026-11-12: readable, top bar fits at ~1420 px.

## Fantasy (#68, 2026-11-12, `73e7ea8`)

- Dark wood planks and candlelight page, stitched leather title bar with iron edge, iron-banded panels (border/shadow only; panels stay solid), stone inputs, parchment text/buttons/sliders. No animation. Body text Georgia (system) for reading; old-style numerals show in "100 %".
- Font: IM Fell English SC (Igino Marini), SIL OFL 1.1, no Reserved Font Name, Fontsource 5.3.0 Latin woff2; single weight, so fake bold is off.
- Gotcha (2026-11-12): no SVG or small image files for ornaments: Vite inlines them as `data:` URIs, blocked by CSP `img-src 'self'`. CSS only.
- Test `tests/app/fantasy-theme.spec.ts`. Chief of staff looked at `fantasy-campaign-after.png`: readable, distinct, top bar fits at 1420 px.
