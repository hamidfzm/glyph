# Brand tokens

Glyph's visual identity, **Cobalt Ink**: a cool neutral ground, one pigment accent, and an editorial reading face. This file is the single reference. The app implements it in `src/styles/app.css` (palette plus the reading face) and applies the reading face in `src/styles/markdown.css`; the marketing site (`glyph-md/glyph-md.github.io`, `src/styles/global.css`) is to mirror these values rather than define its own; it still carries its old warm palette and is updated separately, since it lives in another repo.

## Palette

| Role | Light | Dark |
| --- | --- | --- |
| Surface | `#ffffff` | `#1c1c1e` |
| Surface, secondary | `#f5f5f7` | `#2c2c2e` |
| Surface, tertiary | `#e8e8ed` | `#3a3a3c` |
| Text, primary | `#1d1d1f` | `#f5f5f7` |
| Text, secondary | `#6e6e73` | `#98989d` |
| Text, tertiary | `#aeaeb2` | `#636366` |
| Hairline | `#d2d2d7` | `#38383a` |
| Accent | `#2f4fe0` | `#6d8bff` |
| Accent, hover | `#2540c4` | `#5b7cff` |

The ground is deliberately cool and near-neutral, so the accent is the only pigment on screen. Accent text on its own surface is 6.33:1 in light and 5.50:1 in dark, both above the 4.5:1 AA threshold for body text.

That figure does not cover white text *on* the accent, which is what the primary buttons, banner actions and the active file-tree row use: 6.33:1 in light but **3.09:1 in dark**. Light improved (Apple blue gave 4.02:1); dark regressed (it gave 3.65:1). Neither the old nor the new dark value reaches the 4.5:1 required for text under 18.66px bold or 24px regular, and 3:1 is not an alternative here: that threshold is for component boundaries, not for text drawn on them. Closing this means darkening the dark accent where it is used as a background, which trades against its 5.50:1 as text. Tracked as a known gap rather than silently claimed as AA.

## Type

| Role | Stack |
| --- | --- |
| Reading (document body) | `'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, ui-serif, serif` |
| Interface (chrome) | per platform, see `src/styles/platform.css` |
| Code | `'SF Mono', 'Fira Code', 'Cascadia Code', 'JetBrains Mono', monospace` (`markdown.css`; `FONT_FAMILY_MAP.mono` and a few `ui-monospace` fallbacks differ, and are not kept in step) |

All three are system stacks; Glyph bundles no font files. None of the reading stack covers Han or Arabic, so Persian and Chinese prose falls through to the platform's generic `serif` (Songti, SimSun) rather than the UI face it used before.

Two export targets cannot carry the reading face: PDF (pdfmake ships Roboto only, and other faces need embedded font files) and DOCX (no default run font is set). HTML, EPUB, the site export, and print all get it. A reader's *chosen* font reaches print, which drives the live document, but no file export: `collectStyles` serialises stylesheets and the choice is written as an inline style on `<html>`, so exported files always show the default reading face. The reading face is what separates the document from the interface: prose is set in the serif while the chrome stays on the platform UI font, so the document reads as a document rather than as part of the app.

## The mark

A **pilcrow** in white on a cobalt superellipse tile. The pilcrow is the printer's mark for a paragraph, so the icon is itself a glyph: the thing the app is named for and the thing it renders. It also avoids the initial-in-a-rounded-square that most editors reach for.

The outline is the pilcrow from **Source Serif 4** (SIL Open Font License 1.1), which permits derived artwork. No font file ships with the app; the glyph is flattened to a path in the master.

- Master: `src-tauri/icons/icon.svg`, with `src-tauri/icons/icon-foreground.svg` for the Android adaptive layer.
- Regenerate every raster with `pnpm icons`, which reads `icon-manifest.json`.
- `tauri icon` writes the desktop set and the `src-tauri/gen/` mobile projects, but **not** `src-tauri/icons/android/`, `src-tauri/icons/ios/`, or `public/favicon.png`. Those are copied from the generated output, or a mobile re-init silently restores the old mark.
- The Android foreground is sized by `icon-foreground.svg` alone, at 59% of the canvas, inside the 66% safe zone a launcher guarantees. `android_fg_scale` stays at 100 so the scale lives in one place; setting both multiplies them and shrinks the mark.
- iOS icons are square, full-bleed and **opaque**. Apple applies its own mask, so no rounded corners are baked in, and an alpha channel fails App Store validation even when every pixel is opaque. Flatten onto the tile colour after regenerating.

## Adding or changing a token

Some values carry the accent as a separate literal and do **not** follow `var(--color-accent)`. Change them together or the app ends up half-recoloured:

- `--glyph-canvas-selection` (`src/styles/app.css`): plain rgba on purpose. html2canvas re-renders the DOM during export and aborts on `color-mix()`.
- `--color-banner-bg` (`src/styles/app.css`): a hand-mixed accent tint for the update bar.
- The `read("--color-accent", …)` fallbacks in `src/lib/graphCanvas.ts`.
- `LINK_COLOR` (`src/lib/export/htmlToPdf.ts`), used by both PDF paths: pdfmake cannot read custom properties, and pages export on white even in dark mode, so this one is the *light* accent.
- The reading stack itself, in `src/styles/app.css` and `FONT_FAMILY_MAP.serif` (`src/lib/settings.ts`). A test in `settings.test.ts` fails if the two drift.
- The pre-paint splash colours in `index.html`, which run before any stylesheet loads.
- On the website: the `theme-color` meta in `src/layouts/Base.astro`, plus the mark in `public/favicon.svg` and its inline duplicate in `src/components/Logo.astro`.

Not part of the brand, and deliberately left alone: the `#0969da` values in `src/lib/export/html.ts` and `src/lib/export/site/themes.ts`. Those are the GitHub theme for documents users export, not Glyph's own chrome.
