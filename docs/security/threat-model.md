# Glyph Filesystem Threat Model

Glyph renders untrusted markdown (and runs third-party plugins) inside a Tauri
webview that can invoke Rust commands. This document describes the trust
boundary and the backend-managed filesystem grants that enforce it (issue
#433). Plugin sandboxing (issue #434) narrows what plugins get: isolation is
the default, and full trust is a separate, persisted user grant.

## Trust boundary

The webview is treated as untrusted after compromise. A markdown parser bug,
a malicious plugin, or an XSS in any rendered content is assumed to give an
attacker full JavaScript execution in the renderer, including the ability to
call every registered Tauri command with arbitrary arguments and to edit
renderer-writable state (the settings store).

The security goal: a compromised renderer must not be able to read or write
files the user never opened or exported to in this app.

## Grants

`src-tauri/src/grants.rs` holds a `GrantRegistry` (Tauri managed state) with
four grant kinds. Every path is canonicalized on both sides (grant time and
check time), so `..` traversal and symlinks inside a granted tree cannot
escape it. For paths that do not exist yet (export targets), the nearest
existing ancestor is canonicalized and the remainder re-appended; a `..` in
the missing remainder is rejected.

| Grant | Scope | Rights |
| ----- | ----- | ------ |
| workspace | folder, recursive | read, write, watch |
| file | exact path | read, write (autosave), watch |
| export dir | folder, recursive | write only |
| export file | exact path | write only |

Grants are minted only from backend-observed events, never from a bare
webview-supplied path:

- CLI launch arguments (folder, file, `--export-website` output directory)
- Drag-and-drop onto a window (the OS event carries the path)
- macOS `RunEvent::Opened` and second-instance launches
- Native pick dialogs run in Rust (`src-tauri/src/commands/pick.rs`): Open
  Folder, Open File(s), export Save As, website export destination
- Session restore: at startup the backend reads the persisted settings store
  itself and grants the previously open tabs and recent files
- `set_window_workspace`, when a window reports the workspace it adopted

Workspace and file grants are also mirrored into Tauri's runtime
asset-protocol scope so `asset://` image URLs resolve only inside granted
locations (the static scope in `tauri.conf.json` is empty).

Grants live for the app session. Closing a workspace does not revoke its
grant: another window may still show the same folder and loose tabs from it
may stay open.

Plugin installs from a folder use a fifth, narrow slot: `pick_plugin_dir`
stashes the picked folder in the registry and `install_plugin` (which takes
no path argument) consumes it, so the install source can never be a
webview-typed path.

## Gated commands

Every filesystem command validates against the registry before touching disk
and returns the same denial message (`path is outside the allowed workspaces
and files: <path>`), which never echoes the grant list.

| Command | Check |
| ------- | ----- |
| `read_file`, `get_file_metadata`, `read_directory`, `list_markdown_files`, `scan_wikilinks` | readable |
| `write_file`, `write_binary_file`, `create_dir_all` | writable |
| `copy_file` | source readable and destination writable |
| `watch_file`, `watch_directory` | readable (unwatch stays open; it only drops a watcher) |
| `create_note`, `create_canvas`, `create_folder`, `rename_path`, `duplicate_path`, `move_path`, `delete_path` | `root` must be a granted workspace, plus the pre-existing within-root checks |
| `workspace_get_last_file`, `workspace_set_last_file` | granted workspace |
| `sync_*` | granted workspace (`sync_clone_remote` clones into the workspace path itself) |
| `install_plugin` | consumes the pending picked folder; no path argument |

`workspace_resolve` is deliberately not gated: it is the pre-open probe that
inspects a folder before it becomes a workspace (the grant is minted when the
open is routed). It canonicalizes and reports repo/nesting facts only; it
neither reads document content nor writes.

## Content Security Policy

`tauri.conf.json` replaces the previous `default-src *` policy with
`default-src 'self'` plus narrow carve-outs. Each exception exists for a
feature:

- `connect-src https: http:` stays broad only because the Ollama server URL
  is user-configurable to arbitrary LAN hosts (plus update checks and the
  plugin marketplace over HTTPS).
- `script-src data: blob: 'wasm-unsafe-eval'` is required by the Mermaid and
  D2 WASM renderers.
- `script-src 'unsafe-eval'` is required by D2 alone: its blob-URL worker
  loads the ELK layout engine via `new Function(...)`, and WebKit (WebKitGTK
  on Linux, WKWebView on macOS) enforces the page CSP inside blob workers, so
  without it every D2 render fails there. CSP offers no way to grant eval to
  one worker only. The practical loss is small: `script-src` already allows
  `data:` and `blob:` scripts, so an attacker who can inject markup can
  already run arbitrary script without `eval`.
- `style-src 'unsafe-inline'` is required by markdown theming and syntax
  highlighting (`dangerousDisableAssetCspModification` keeps Tauri from
  rewriting it).
- `img-src`/`media-src` allow `asset:` (scoped by the runtime grants above),
  `data:`/`blob:` for exports and diagram rendering, and `https:`/`http:`
  because documents legitimately embed remote images and media; a remote fetch
  exposes the viewer's IP to the embedded host, same as any markdown viewer.
- `object-src 'none'`, `frame-src 'none'`, `base-uri 'self'`, and
  `form-action 'none'` close the remaining injection sinks.

The dev CSP is identical plus the Vite dev server and HMR websocket on
`localhost:1420`.

The JS dialog plugin's `open`/`save` permissions were removed from the
capability file; only `ask`/`message` remain. All pickers run in Rust.

## Residual risks

- **Persisted-session grant staging.** The settings store (`settings.json`)
  is renderer-writable, and the backend seeds grants from it at the next
  launch, so a compromised renderer can stage grants for paths it names
  there. This matches the trust the file already carries (it decides what
  reopens on launch). The same applies to `set_window_workspace`, which
  grants the workspace a window reports adopting; both are accepted so
  session restore keeps working, and both only matter after the renderer is
  already compromised.
- **`connect-src` breadth.** Arbitrary `http:`/`https:` hosts are reachable
  for the Ollama integration, so a compromised renderer can exfiltrate what
  it can read. The grants bound what that is.
- **`style-src 'unsafe-inline'`.** CSS injection in rendered markdown remains
  possible; it cannot reach the filesystem.
- **Plugins.** Plugins run sandboxed by default (issue #434): a manifest
  without a `sandbox` flag is isolated in a worker, filesystem reads require
  the declared-and-accepted `workspace:read` permission, and the worker's
  network is fenced to declared `network:` hosts. A plugin that declares
  `"sandbox": false` still executes in the app context and sees everything the
  renderer sees; that mode requires an explicit full-trust consent, persisted
  per plugin, and marketplace packages are SHA-256-verified against the
  reviewed registry entry before install.
