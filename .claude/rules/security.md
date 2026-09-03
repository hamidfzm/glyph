---
paths:
  - "src-tauri/**"
  - "src/lib/plugins/**"
  - "src/lib/telemetry.ts"
  - "docs/security/**"
---

# Security Rules

The renderer is untrusted after compromise: assume it can call every registered command with arbitrary arguments (see [docs/security/threat-model.md](../../docs/security/threat-model.md) and INV-5/INV-6 in [docs/engineering-invariants.md](../../docs/engineering-invariants.md)). These rules keep the backend the boundary.

## Commands and paths

- **Every command that takes a path checks the `GrantRegistry` first** (`ensure_readable`, `ensure_writable`, `ensure_workspace`), before any filesystem call and before routing. "Callers always pass a picker result" is a description of the UI, not a control; a doc comment saying so is a bug.
- **Canonicalize the target itself, not just its parent.** `<root>/..` has parent `<root>` and passes a parent-only check. Existing targets canonicalize and must sit strictly inside the root (never equal to it); targets that do not exist yet canonicalize the nearest existing ancestor and reject `..` in the remainder (`canonicalize_lenient`).
- **Canonicalize symlink sources and refuse those resolving outside the root; refuse symlink entries when copying a tree.** A link inside a workspace can resolve outside it, and copying it materializes the target where `read_file` then serves it. Refuse loudly rather than skip silently (INV-7).
- **Grants are minted only from backend-observed events** (CLI args, OS open events, drag-and-drop, Rust pickers, the settings seed at startup). A command that receives a renderer path checks it; it never grants it.
- **Every new gated command gets a denial test** driving the command with an ungranted path, plus the applicable rows of the adversarial scenario matrix.
- Commands return `Result<T, String>`; a gate that cannot fail is not a gate.

## Capabilities (`src-tauri/capabilities/*.json`)

- **No permission without a call site.** Grant the exact `plugin:allow-<command>` entries the frontend invokes; avoid `plugin:default` sets unless every member is used. Read the plugin's `permissions/default.toml` before trusting the name.
- **Platform-specific permissions live in platform-scoped capability files** (`mobile.json` with `platforms: [android, iOS]`), so the desktop surface never carries a mobile-only grant.
- **Never grant a command that resolves renderer-supplied paths against a base directory** (`store:allow-load`, `fs:allow-*` outside an explicit scope, `dialog:allow-open`/`allow-save` on desktop): absolute paths replace the base and the pickers widen the fs and asset scopes.
- **A capability change updates the threat model in the same PR.** The doc lists which permissions exist and why; a stale claim there is treated as a security bug.

## Renderer-side state

- **Nothing security-relevant lives only in renderer-writable state.** Consent, hashes, and allowlists that gate backend behavior are verified in Rust, not read back from `settings.json` or `plugins.json`.
- **Secrets never cross IPC unless a command needs the value**; prefer presence checks (`secret_has`). No secret in a URL, log line, error string, or Sentry breadcrumb.

## Telemetry

- Anything that may contain a path (error strings from Rust included) goes through the redaction in `src/lib/telemetry.ts` and `src-tauri/src/telemetry.rs`. A change to either comes with cases for paths containing spaces, Windows verbatim paths (`\\?\C:\...`), and file URLs.

## Handling findings

- **No public spec issue for an unfixed vulnerability.** A security fix goes straight to a `fix/<slug>` branch; the PR is the disclosure. Report intake follows [SECURITY.md](../../SECURITY.md).
- A fix names the invariants it restores in the PR body and adds the regression test that would have caught it.
