---
paths:
  - "src/**/*.{ts,tsx}"
  - "src-tauri/src/**/*.rs"
---

# Code Organization Rules

Keep files focused and readable. When a file starts to do more than one thing, split it before adding more.

- One concern per file. A component file renders the component; pull schemas, regexes, lazy-loaders, sanitizers, and pure helpers into siblings.
- Soft cap of ~200 lines per file. Hitting the cap is a signal to split, not a hard error.
- Hooks live in `src/hooks/`. UI in `src/components/`. Pure logic next to its consumer or in `src/lib/`.
- Module-level singletons (cached promises, counters) belong in their own module so the cache is shared and easy to find.
- Tests sit beside the file under test (`Foo.tsx` ↔ `Foo.test.tsx`).
- Don't pre-split for hypothetical reuse — split when the current file actually has two responsibilities.
- Path imports: use the `@/` alias (resolves to `src/`) **only when an import crosses between the top-level dirs under `src/`** (`components`, `hooks`, `lib`, `contexts`, `styles`, `test`) — e.g. a component importing a hook writes `@/hooks/useTabs`, never `../../hooks/useTabs`. **Stay relative when the import stays within one top-level dir**, even if it goes up and over into a sibling subtree. So from `src/components/markdown/`: a sibling is `./CsvTable`, a child is `./icons/Bar`, and a sibling subtree is `../icons/CopyIcon` (not `@/components/icons/CopyIcon`). Rule of thumb: `@/` only when the first path segment after `src/` changes; otherwise relative, including `../`. The alias is wired in `tsconfig.json`, `vite.config.ts`, and `vitest.config.ts`.

The root shell (`App.tsx`) and its wiring component (`AppShell.tsx`) have additional rules in [app-shell.md](./app-shell.md) — read it before adding new effects, state, or props to either file.
