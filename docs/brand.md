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

That figure does not cover white text *on* the accent, which is what the primary buttons and the active file-tree row use: 6.33:1 in light but 3.09:1 in dark. The dark case clears the 3:1 floor for UI components and not the 4.5:1 one for small text, so keep dark-mode accent buttons at or above 14px.

## Type

| Role | Stack |
| --- | --- |
| Reading (document body) | `'Iowan Old Style', Palatino, Georgia, serif` |
| Interface (chrome) | per platform, see `src/styles/platform.css` |
| Code | `'SF Mono', 'Fira Code', 'Cascadia Code', 'JetBrains Mono', monospace` |

All three are system stacks; Glyph bundles no font files.

Two export targets cannot carry the reading face: PDF (pdfmake ships Roboto only, and other faces need embedded font files) and DOCX (no default run font is set). HTML, EPUB, the site export, print, and the canvas PNG all get it. A reader's *chosen* font never reaches any export either, because `collectStyles` serialises stylesheets and the choice is written as an inline style on `<html>`; exports therefore always show the default reading face. The reading face is what separates the document from the interface: prose is set in the serif while the chrome stays on the platform UI font, so the document reads as a document rather than as part of the app.

## Adding or changing a token

Some values carry the accent as a separate literal and do **not** follow `var(--color-accent)`. Change them together or the app ends up half-recoloured:

- `--glyph-canvas-selection` (`src/styles/app.css`): plain rgba on purpose. The canvas PNG export re-renders the DOM through html2canvas, which aborts on `color-mix()`.
- `--color-banner-bg` (`src/styles/app.css`): a hand-mixed accent tint for the update bar.
- `LINK_COLOR` (`src/lib/export/canvasPdf.ts`): the PDF engine cannot read CSS custom properties.
- The `read("--color-accent", …)` fallbacks in `src/lib/graphCanvas.ts`.
- `LINK_COLOR` (`src/lib/export/htmlToPdf.ts`), used by both PDF paths: pdfmake cannot read custom properties, and pages export on white even in dark mode, so this one is the *light* accent.
- The reading stack itself, in `src/styles/app.css` and `FONT_FAMILY_MAP.serif` (`src/lib/settings.ts`). A test in `settings.test.ts` fails if the two drift.
- The pre-paint splash colours in `index.html`, which run before any stylesheet loads.

Not part of the brand, and deliberately left alone: the `#0969da` values in `src/lib/export/html.ts` and `src/lib/export/site/themes.ts`. Those are the GitHub theme for documents users export, not Glyph's own chrome.
