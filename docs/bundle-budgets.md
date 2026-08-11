# Bundle Budgets

CI enforces gzip size budgets on the frontend bundle so size regressions fail a
PR instead of shipping silently. The gate is `scripts/check-bundle-size.mjs`,
run by the `Check bundle budgets` step of the `ubuntu-22.04` build leg after
the frontend is built; budgets live in [`bundle-budgets.json`](../bundle-budgets.json).

Run it locally against a fresh production build:

```bash
pnpm build && pnpm size:check
```

## What is measured

- **startup**: every asset referenced from `dist/index.html` (the entry script,
  stylesheets, and any modulepreloads). This is what every launch parses.
- **Named lazy chunks**: each `chunks` entry in `bundle-budgets.json` matches
  `dist/assets/` files by filename prefix and sums them. These load on first
  use of their feature, so their cost is first-use latency plus installer size.
- **Unbudgeted assets**: any other asset (chunk, stylesheet, font) above
  `unbudgetedChunkGzipLimit` fails the check. A new heavyweight dependency must
  get a stable chunk name (via `manualChunks` in `vite.config.ts` or its
  natural file name) and an explicit budget before it can merge.

Budgets are gzip bytes (gzip is what matters for install/transfer size; raw
sizes are recorded in the CI step summary for parse-cost context). Each budget
is the measured size plus roughly 10% headroom, so dependency bumps pass while
a feature accidentally landing in the wrong chunk does not.

## What keeps startup small

The startup chunk is the markdown viewer shell: React, the remark/rehype
pipeline, the Tauri API glue, i18n, and the app shell components. Everything
optional loads on first use:

- Editor (CodeMirror), notebook, canvas, graph view, and the settings modals
  are `lazy()` components (`lazyEditor`, `lazyNotebook`, `lazyCanvas`,
  `lazyGraph`, `lazySettings`, `lazyWorkspaceSettings`).
- The AI chat panel (`lazyAIChatPanel`) and plugin marketplace modal
  (`lazyPluginsModal`) load on first open.
- Syntax highlighting, KaTeX, and the gemoji table load when a document first
  needs them (`lazyHighlight`, `lazyKatex`, `lazyGemoji`).
- The Sentry SDK loads only after the production telemetry opt-in
  (`src/lib/telemetry.ts`); error reporting before that is a no-op by design.
- The export pipeline (`src/lib/export/*`) is reached only through dynamic
  imports in `useExport`, `usePrint`, `useCliExport`, `useExportSite`, and the
  plugin exporter runner, which keeps docx/epub/pdfmake/html2canvas out of
  startup entirely.

When adding a feature, put its heavy dependencies behind one of these seams
(or a new `lazy()` wrapper following the same pattern). If startup legitimately
needs to grow, raise `startup` in `bundle-budgets.json` in the same PR and
explain why in the PR description.

## D2 delivery decision

`@terrastruct/d2` ships as a single 8 MB browser file with the WASM compiler
inlined as base64 (gzip ~5.9 MB); as of the latest upstream release (0.1.33)
there is no split `.wasm` asset or slimmer browser build. Repackaging the WASM
ourselves would mean patching upstream's blob-worker bootstrap, which is
CSP-sensitive (see the WebKit smoke suite) and would break on every upgrade.

Accepted tradeoff: the chunk stays lazy behind `d2Render.ts`, so it is parsed
only on the first D2 diagram render and never touches startup; the cost that
remains is installer size. Revisit if upstream publishes a separable WASM
artifact; the budget pins today's size so an upstream regression is visible.

## Updating budgets

1. Build and measure: `pnpm build && pnpm size:check`.
2. If a group legitimately grew (new feature, dependency bump), set its budget
   to the new measured size plus ~10% and note the reason in the PR.
3. If a budgeted chunk disappeared or was renamed, update its `prefix`; the
   check fails loudly on prefixes that match nothing, so stale entries cannot
   linger.
