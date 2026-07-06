---
paths:
  - "src/**/*.{ts,tsx}"
  - "src-tauri/src/**/*.rs"
---

# Code Organization Rules

Keep files focused and readable. When a file starts to do more than one thing, split it before adding more.

- **Exactly one React component per file**, named after the file (`Foo.tsx` exports `Foo`). This is strict and has no "small/cohesive set" exemption: every icon in `src/components/icons/` is its own file (never a shared `menuIcons.tsx`/`icons.tsx` bundling several), and a private sub-component used only by its parent (a menu row, a panel header, a toolbar button) still moves to its own file and is imported back. If several files share a tiny presentational frame, that frame is itself one component in its own file (e.g. `MenuIconBase.tsx`). Pull schemas, regexes, lazy-loaders, sanitizers, shared class-name constants, and pure (non-JSX) helpers into sibling modules too.
  - Only exception: a set of thin `lazy()` + `Suspense` wrapper entrypoints for one feature (e.g. `lazyNotebook.tsx`, `lazyEditor.tsx`) is a single code-splitting concern and may group its wrappers in one file.
- Soft cap of ~200 lines per file. Hitting the cap is a signal to split, not a hard error.
- Hooks live in `src/hooks/`. UI in `src/components/`. Pure logic next to its consumer or in `src/lib/`.
- **No pure helpers defined inside a component file, not even one-liners.** A function that takes data and returns data with no JSX and no component state (a file-type/extension predicate, a path/string transform, a formatter, a comparator) belongs in `src/lib/`, and a predicate joins the module that owns its siblings rather than starting a new one: `isSvgFile` lives in `src/lib/imageExtensions.ts` next to `isImageFile`, not as a local `isSvgPath` in `ImageViewer.tsx`. The component imports it. This keeps the logic testable in isolation and discoverable by the next caller instead of duplicated. (A closure that genuinely closes over props/state, such as an event handler or a memoised callback, stays in the component; it isn't a pure helper.)
- Module-level singletons (cached promises, counters) belong in their own module so the cache is shared and easy to find.
- Tests sit beside the file under test (`Foo.tsx` ↔ `Foo.test.tsx`).
- Don't pre-split for hypothetical reuse; split when the current file actually has two responsibilities.
- Path imports: an import is either **same-directory relative or absolute**, never parent-relative. Use `./` only for modules in the same directory or a subdirectory of it (`./CsvTable`, `./icons/Bar`). Everything else uses the `@/` alias (resolves to `src/`): a component importing a hook writes `@/hooks/useTabs`, and a component reaching a sibling subtree writes `@/components/icons/CopyIcon`. **`../` imports are not allowed.** The alias is wired in `tsconfig.json`, `vite.config.ts`, and `vitest.config.ts`. Existing `../` imports migrate opportunistically: when you touch a file, convert its parent-relative imports to `@/` in the same change.

The root shell (`App.tsx`) and its wiring component (`AppShell.tsx`) have additional rules in [app-shell.md](./app-shell.md); read it before adding new effects, state, or props to either file.
