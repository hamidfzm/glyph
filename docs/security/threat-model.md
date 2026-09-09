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

- CLI launch arguments (folder, file, the `export` subcommand's `--format` and `--out`, the `serve` subcommand's `--host` and `--port`)
- Drag-and-drop onto a window (the OS event carries the path)
- macOS `RunEvent::Opened` and second-instance launches
- Native pick dialogs run in Rust (`src-tauri/src/commands/pick.rs`): Open
  Folder, Open File(s), export Save As, website export destination
- Session restore: at startup the backend reads the persisted settings store
  itself and grants the previously open tabs and recent files

`request_open` and `open_in_new_window` are deliberately not on that list.
Both take a renderer-supplied path (a picker result in the legitimate flows,
anything at all from a compromised renderer), so both check it against the
existing grants **before** routing and refuse otherwise: `request_open`
routes a folder that must already be a granted workspace root (routing
re-grants it recursively, so a subfolder or an exact-file grant may not pass),
`open_in_new_window` a file that must be readable. They can therefore only
ever re-scope a path the session already holds; a new window never widens
the process's filesystem reach. `set_window_workspace`, which a window calls
to report the workspace it shows, updates routing state only and mints
nothing.

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
| `read_file`, `get_file_metadata`, `read_directory`, `list_markdown_files`, `scan_wikilinks`, `scan_metadata` | readable |
| `vault_snapshot`, `vault_refresh`, `vault_backlinks`, `vault_resolve`, `vault_neighbors`, `vault_query`, `vault_paths_with_tag`, `vault_canvas` | granted workspace, not merely readable: the index is per workspace, and a readable check would also accept every directory inside one, letting a caller cache an index per subdirectory. The second path argument is answered from the index in memory, never read from disk, so an ungranted one returns nothing rather than content |
| `write_file`, `write_binary_file`, `create_dir_all` | writable |
| `copy_file` | source readable and destination writable |
| `watch_file`, `watch_directory` | readable (unwatch stays open; it only drops a watcher) |
| `create_note`, `create_canvas`, `create_folder` | `root` must be a granted workspace and the target directory canonicalizes inside it |
| `rename_path`, `duplicate_path`, `move_path`, `delete_path` | `root` must be a granted workspace and the entry itself canonicalizes strictly inside it (a trailing `..`, the root itself, or a symlink resolving outside is refused; `duplicate_path` refuses a folder containing a symlink rather than copying its target) |
| `request_open` | folders only; the path must already be a granted workspace root |
| `open_in_new_window` | readable |
| `workspace_get_last_file`, `workspace_set_last_file` | granted workspace |
| `sync_*` | granted workspace (`sync_clone_remote` clones into the workspace path itself); `sync_init_repo`, `sync_clone_remote`, and `sync_set_origin` accept only `https://` without credentials, `ssh://`, or scp-like `user@host:path` remotes, since libgit2 would also take a local path or `file://` (pulling any local repository into a granted workspace) and cleartext `http://`/`git://` |
| `install_plugin` | consumes the pending picked folder; no path argument |

`vault_forget` takes no readable check: it only drops an index the process
already built, so the worst a renderer can do with it is make the next
snapshot rebuild from disk.

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

## Plugin permissions

`capabilities/default.json` grants no permission set whose members resolve
renderer-supplied paths: the dialog, filesystem, and store plugins get the
exact commands the frontend calls instead of their `default` sets. The
remaining default sets (`core`, `os`, `opener`, `http`) reach no file; the
opener's `reveal_item_in_dir` takes a path but only opens the file manager at
it, and `http:default` is scoped to the marketplace hosts.

- **Dialog.** Desktop holds `dialog:allow-message` alone (it backs `ask`).
  The plugin's `open` command adds whatever the user picks to the fs and asset
  scopes, so `dialog:allow-open` lives in `capabilities/mobile.json`
  (`platforms: [android, iOS]`), where the OS document picker replaces the
  Rust pickers. All desktop pickers run in Rust.
- **Filesystem.** No `fs:` permission on desktop; file I/O goes through the
  gated Rust commands. `fs:default` pulls in the `scope-app-recursive` scope
  (`$APPCONFIG/**`, `$APPDATA/**`, and the other app-specific directories),
  and the plugin unions the global and per-command scopes for every command
  it exposes, so a scope granted for reads also authorizes `write_text_file`.
  Plugins are installed under `app_config_dir()`, so that would let a
  compromised renderer overwrite installed plugin code and have it loaded on
  the next launch, bypassing the grant registry entirely. The plugin lives in
  `capabilities/mobile.json`, gated to Android and iOS, where it reads the
  sandboxed `content://` URIs the Rust commands cannot open. A unit test in
  `lib.rs` fails if any `fs:` permission returns to the default capability
  (#698).
- **Store.** No `store:allow-load`: `load` resolves the requested path against
  AppData, and an absolute path replaces the base, so it would read or
  overwrite any JSON file the user can write. The backend opens
  `settings.json`, `plugins.json`, and `workspace-sessions.json` in
  `setup.rs`; the renderer attaches with `getStore` and holds the per-key
  commands only.

## Residual risks

- **Persisted-session grant staging.** The settings store (`settings.json`)
  is renderer-writable, and the backend seeds grants from it at the next
  launch, so a compromised renderer can stage grants for paths it names
  there. This matches the trust the file already carries (it decides what
  reopens on launch); it is accepted so session restore keeps working, and it
  only matters after the renderer is already compromised.
- **`glyph serve` is an inbound listener.** The one place Glyph accepts
  connections rather than making them. It binds `127.0.0.1` unless `--host`
  says otherwise, answers only to `Host` headers naming itself (so a web page
  cannot reach it by re-pointing its own domain at loopback), refuses hidden
  paths, and relies on `tower-http`'s `ServeDir` to keep requests inside the
  output directory. What it serves is still unauthenticated: anyone who can
  reach the port reads the whole exported site, and `--host 0.0.0.0` extends
  that to the network, which is why it is opt-in and warns. Everything in the
  output directory is published, so the CLI refuses an `--out` that contains,
  or is contained by, the folder being served. The site is derived output, not
  the workspace: serving grants no filesystem access back to the renderer.
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
