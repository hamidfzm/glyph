---
paths:
  - "src/**/*.{ts,tsx,css}"
  - "src-tauri/src/**/*.rs"
---

# Cleanup Rules

When you remove a feature, delete a section, or refactor, finish the job. Half-removed code is worse than no change: it confuses readers, fails lints later, and rots into bugs.

In the same commit as the removal, also delete or update:

- **Callers and prop drilling.** If a function, hook, or component is gone, remove every import, every call site, and every type field that referenced it (props, context values, action objects, settings keys, event payloads).
- **Tests.** Drop `*.test.ts`/`*.test.tsx` cases and mocks that exercise the removed code. Don't leave a `skip` or a comment, just delete.
- **Types and enums.** Prune fields, variants, and union members that no caller writes anymore. If an interface only had one consumer and that consumer is gone, the interface goes too.
- **Settings.** Remove now-unused entries from `src/lib/settings.ts` defaults, types, and the `SettingsModal` UI. If migration is needed for users with old persisted values, do it in the same PR.
- **Menu items, shortcuts, and capabilities.** Drop entries from `src-tauri/src/menu.rs`, accelerators in `src/lib/keyboard.ts`, and capability grants in `src-tauri/capabilities/*.json` that no longer have a handler.
- **Rust commands.** Remove `#[tauri::command]` functions whose only callers were the deleted frontend code, and prune them from `tauri::generate_handler![…]`.
- **Styles.** Delete CSS classes, custom properties, and `data-*` selectors used only by the removed UI. Remove the corresponding `@import` in `src/styles/app.css` if a whole file goes.
- **Docs.** Update `README.md`, `samples/README.md`, and any rule files that referenced the removed behaviour. If the change drops a keyboard shortcut, remove the row from the shortcuts table.
- **Dependencies.** If a package or crate is no longer used after the change, remove it from `package.json` / `Cargo.toml` and refresh the lockfiles.

Verify with the toolchain, not by eye: run `pnpm typecheck`, `pnpm lint`, and `cargo check` before opening the PR. Biome's `noUnusedImports` and `noUnusedVariables` plus `cargo`'s dead-code warnings catch most leftovers; treat any new warning as a blocker.

Refactors get the same rule: when you replace `oldThing` with `newThing`, delete `oldThing` and every adaptor or compatibility shim once the migration is finished. Don't leave deprecated paths "just in case". If a follow-up really must exist, file an issue and link it, don't drop a `// TODO`.
