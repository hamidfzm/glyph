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
