# Engineering Invariants

Non-negotiable guarantees for Glyph. Every stateful or security-sensitive change is reviewed against this list, and every PR that touches a risk area must name the invariants at stake and point at evidence (see the Risk classification section of the [PR template](../.github/PULL_REQUEST_TEMPLATE.md)). Reviewers use this document as their rubric; a review of a change that touches an invariant must include a concrete counterexample attempt against it.

## Invariants

### INV-1: User edits are never silently discarded

A user edit is never discarded without a completed durable write or an explicit, informed discard by the user.

- Owners: `src/hooks/useTabs.ts` (save path, dirty tracking), `src/hooks/useAutoSave.ts`, `src/hooks/useWindowClose.ts`
- Evidence: `src/hooks/useAutoSave.test.ts`, `src/hooks/useTabs.test.tsx`

### INV-2: Empty is not absent

Empty string is valid loaded document content. `null`/`undefined` represents absence or a loading state. The two are never conflated in types, conditions, or UI.

- Owners: `src/hooks/useTabs.ts` document state, any component branching on content
- Evidence: type signatures; tests asserting empty-document round trips

### INV-3: Stale results never win

Older asynchronous work cannot overwrite newer state or mark it complete. Writes to the same path are serialized; completions are revision-guarded.

- Owners: `src/hooks/useTabs.ts` (`writeChains`, revision guards)
- Evidence: `src/hooks/useTabs.test.tsx` stale-completion cases

### INV-4: Owners flush before they die

Closing or replacing an owner (tab, workspace, window) flushes or transfers every pending operation it owns. Nothing pending is dropped on unmount, tab close, workspace switch, or app exit.

- Owners: `src/hooks/useTabs.ts` close-flush coordination, `src/hooks/useWindowClose.ts`
- Evidence: lifecycle transition tests (edit -> switch -> close, shutdown flush)

### INV-5: All external input is untrusted

Renderer input, Markdown content, plugins, filenames, URLs, and IPC arguments are untrusted until validated. See the [threat model](security/threat-model.md).

- Owners: `src-tauri/src/grants.rs`, every Tauri command, Markdown/link/image rendering components
- Evidence: negative tests in `src-tauri/src/grants.rs` and command test modules

### INV-6: The backend is the boundary

Frontend permission labels and disabled buttons are UX, not security boundaries. Backend validation (`grants.rs` `ensure_readable` / `ensure_writable` / `ensure_watchable` / `ensure_workspace`) is authoritative for every filesystem and IPC operation.

- Owners: `src-tauri/src/grants.rs`, `src-tauri/src/commands/`
- Evidence: denial tests driving the command surface without grants

### INV-7: Partial results are explicit

Truncation, fallback, and partial results are represented explicitly in types and UI. No silent truncation, no fallback that pretends to be the full result.

- Owners: any code path that truncates, samples, or falls back
- Evidence: tests asserting the partial state is surfaced, not hidden

## Adversarial scenario matrix

For stateful or security-sensitive changes, tests and PR evidence must cover the applicable transitions:

- empty, normal, large, malformed, and missing input
- success, failure, cancellation, timeout, and retry
- rapid repetition and overlapping operations
- tab switch, workspace switch, unmount, window close, and app exit
- one item versus multiple simultaneously active items
- stale completion after newer state
- trusted versus untrusted caller, and paths inside versus outside grants

## Maintenance

- Every escaped data-loss or security defect adds a regression test and, if needed, a new invariant here.
- Review this catalog at each minor-release kickoff and after every security or data-loss incident.
- Mutation-testing baseline for the persistence and authorization modules is documented here once introduced (#441, Phase 4).
