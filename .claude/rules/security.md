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
- **A lookup is an effect.** `canonicalize`, `exists`, `is_dir`, and `metadata` on a Windows network path connect to the host it names, which can hand that host the user's credentials. A command that "only inspects" a path calls `refuse_remote` before the lookup (`workspace_resolve`), and so does a helper that canonicalizes a second argument once `root` is checked (`ensure_entry_inside_root`). One that only needs the path as a key compares it and looks nothing up (`vault::forget`).
- **Canonicalize the target itself, not just its parent.** `<root>/..` has parent `<root>` and passes a parent-only check. Existing targets canonicalize and must sit strictly inside the root (never equal to it); targets that do not exist yet canonicalize the nearest existing ancestor and reject `..` in the remainder (`canonicalize_lenient`).
- **A link whose target is missing is not a free name.** `exists()` and `canonicalize()` both follow links, so they report a dangling one as absent, while a write to that name follows the link and creates the target wherever it points. Refuse such a link at the boundary (`canonicalize_lenient` does), and decide a name is free with `symlink_metadata`, never `exists()` (`unique_path`).
- **Check the path that will be opened, not the path as spelled.** `<link>/` fails to canonicalize even when the link leads to a file, and `<link>:stream` on Windows is not itself a link, yet opening either goes through the link: ask `symlink_metadata` of the rebuilt path. A fixed name joined onto a checked directory (`<out_dir>/.glyph/site-manifest.json`) is a new path and gets its own check, since a link below a checked directory leads anywhere.
- **A path `Path` finds no prefix in is not thereby local.** On Windows `\??\UNC\host\share` and `\\host\\share` have no `Component::Prefix`, std hands both to the OS as spelled, and the OS connects to the host. A check that decides from the parsed prefix also refuses the NT prefix and two leading separators (`refuse_remote` does). Read how std forwards a spelling before trusting how `Path` parses it.
- **Canonicalize symlink sources and refuse those resolving outside the root; refuse symlink entries when copying a tree.** A link inside a workspace can resolve outside it, and copying it materializes the target where `read_file` then serves it. Refuse loudly rather than skip silently (INV-7).
- **A recursive write grant stops at `.git`.** Git reads its hooks and the `origin` URL from there, so a write below a workspace's or an export folder's `.git` is code the user's next commit runs or a remote a credential is sent to. `ensure_writable` and the file-tree commands refuse the name, in any case.
- **Grants are minted only from backend-observed events** (CLI args, OS open events, drag-and-drop, Rust pickers, the settings seed at startup, a folder the user allows in an MCP client's elicitation prompt). A command that receives a renderer path checks it; it never grants it. Mirroring a path the registry already allows into the asset scope (`allow_document_asset`) is a check, not a grant.
- **Every new gated command gets a denial test** driving the command with an ungranted path, plus the applicable rows of the adversarial scenario matrix.
- Commands return `Result<T, String>`; a gate that cannot fail is not a gate.
- **A repository is judged before libgit2 opens it.** libgit2 resolves the paths a repository names (the target of a `.git` file, `commondir`, alternates, paths in its config, a submodule's `.git`) and has no switch against it, so on Windows a folder's own files can send it to a network host. A sync command goes through `ensure_repository` or `ensure_working_tree`, never straight to `Repository::open`, and nothing opens a repository for a folder that is merely being opened (`resolve_workspace` only asks whether a `.git` entry exists). `Repository::discover` is not used at all: it reads those files in every ancestor.

## Capabilities (`src-tauri/capabilities/*.json`)

- **No permission without a call site.** Grant the exact `plugin:allow-<command>` entries the frontend invokes; avoid `plugin:default` sets unless every member is used. Read the plugin's `permissions/default.toml` before trusting the name.
- **Platform-specific permissions live in platform-scoped capability files** (`mobile.json` with `platforms: [android, iOS]`), so the desktop surface never carries a mobile-only grant.
- **Never grant a command that resolves renderer-supplied paths against a base directory** (`store:allow-load`, `fs:allow-*` outside an explicit scope, `dialog:allow-open`/`allow-save` on desktop): absolute paths replace the base and the pickers widen the fs and asset scopes.
- **Never grant a plugin command that takes a path under no scope**, whatever it does with the path (`opener:allow-reveal-item-in-dir`, which `opener:default` carries, checks that the path exists). Wrap the plugin's Rust API in a command that checks the registry first (`reveal_path`).
- **A capability change updates the threat model in the same PR.** The doc lists which permissions exist and why; a stale claim there is treated as a security bug.

## Renderer-side state

- **Nothing security-relevant lives only in renderer-writable state.** Consent, hashes, and allowlists that gate backend behavior are verified in Rust, not read back from `settings.json` or `plugins.json`.
- **A credential is bound to the host it was entered for.** A token is offered to the remote authority recorded when the user stored it (`BoundToken`), never to whatever host the renderer-writable remote names now.
- **Secrets never cross IPC unless a command needs the value**; prefer presence checks (`secret_has`). No secret in a URL, log line, error string, or Sentry breadcrumb.

## Telemetry

- Anything that may contain a path (error strings from Rust included) goes through the redaction in `src/lib/telemetry.ts` and `src-tauri/src/telemetry.rs`. A change to either comes with cases for paths containing spaces, Windows verbatim paths (`\\?\C:\...`), and file URLs.

## Handling findings

- **No public spec issue for an unfixed vulnerability.** A security fix goes straight to a `fix/<slug>` branch; the PR is the disclosure. Report intake follows [SECURITY.md](../../SECURITY.md).
- A fix names the invariants it restores in the PR body and adds the regression test that would have caught it.
