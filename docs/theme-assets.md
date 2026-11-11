# Theme assets register

Every font, texture and ornament a Theme uses, with its source and licence (spec #58). Fonts are bundled `.woff2` under the SIL Open Font License and never fetched from the network; textures and ornaments are drawn in the repo (CSS, hand-written SVG) or are CC0. A new asset goes here in the same commit that adds it.

Review checklist for every Theme: no occult, Chaos or Mechanicus imagery; no Games Workshop logos, iconography (aquila, faction emblems) or typefaces; licence known.

## Rétro SF (`src/themes/retro.css`)

| Asset | Kind | Source | Licence |
|---|---|---|---|
| Share Tech Mono, regular, Latin subset (`src/themes/fonts/share-tech-mono-latin-400.woff2`) | Display font | Carrois Type Design (Ralph du Carrois), 2012; file as distributed in the Fontsource package `@fontsource/share-tech-mono` 5.3.0 (its Latin subset) | SIL OFL 1.1, Reserved Font Name "Share"; licence text beside the font, `src/themes/fonts/share-tech-mono-OFL.txt` |
| Scanlines (`--texture`) | Texture, window frame only | Drawn in the repo: a CSS `repeating-linear-gradient` | Repo's own |
| Phosphor glow (`--frame`, title glow) | Frame effect | Drawn in the repo: a CSS `radial-gradient` and `text-shadow` | Repo's own |
| Blinking cursor after the title | The theme's one animation, off under reduced motion | Drawn in the repo: a CSS `::after` underscore | Repo's own |

Checklist, 2026-11-11: no occult, Chaos or Mechanicus imagery; no Games Workshop logos, iconography or typefaces; every licence known. The body font stays the system's Arial.

## Fantasy (`src/themes/fantasy.css`)

| Asset | Kind | Source | Licence |
|---|---|---|---|
| IM Fell English SC, regular, Latin subset (`src/themes/fonts/im-fell-english-sc-latin-400.woff2`) | Display font | Igino Marini, 2010, a revival of the Fell types cut for Oxford in the 1680s; file as distributed in the Fontsource package `@fontsource/im-fell-english-sc` 5.3.0 (its Latin subset) | SIL OFL 1.1, no Reserved Font Name; licence text beside the font, `src/themes/fonts/im-fell-english-sc-OFL.txt` |
| Wooden planks (`--texture`) | Texture, window frame only | Drawn in the repo: two CSS `repeating-linear-gradient`s (seams, grain) | Repo's own |
| Candlelight and dark edges (`--frame`) | Frame effect | Drawn in the repo: two CSS `radial-gradient`s | Repo's own |
| Stitched leather title bar | Texture, title bar only | Drawn in the repo: a CSS `repeating-linear-gradient` stitch over a `linear-gradient` sheen, iron edge as a border | Repo's own |
| Riveted iron plate behind the title bar mark | Ornament | Drawn in the repo: a CSS `radial-gradient` rivet repeated in the four corners | Repo's own |
| Iron bands round the panels | Ornament, panel borders only | Drawn in the repo: CSS `border` and `box-shadow` | Repo's own |

Checklist, 2026-11-11: no occult, Chaos or Mechanicus imagery (no pentagrams, sigils, runes or skulls); no Games Workshop logos, iconography or typefaces; every licence known. No animation. The body font is the system's Georgia, a screen serif for reading Notes over a long session.
