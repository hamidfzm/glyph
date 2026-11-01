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
escape it. For paths that do not exist yet (export and Save As targets), the
nearest existing ancestor is canonicalized and the remainder re-appended; a
`..` in the missing remainder is rejected. So is a link in it: each name is
re-appended only when the path it makes is not a symbolic link or, on
Windows, a junction. A path that does not canonicalize can still lead through
one, in two ways. The link's target is missing, so a write would create the
target wherever the link points; or the link leads to a file and the path
ends in a separator, so a read or a write would reach that file. A cloned or
synced workspace can ship either. On Windows a name with a `:` in it is
refused as well, since `name:stream` opens a stream of whatever `name` leads
to. So is a legacy DOS device name (`NUL`, `COM3`, `x\NUL`), before anything
is looked up: Win32 opens the device for it though the path carries no device
prefix. The same goes for a folder of that name above a file that does not
exist yet, which the fallback would otherwise look up. Which names count
changed with Windows 11, so the registry keeps no list of them and asks
Windows how it would rewrite the path, which touches nothing.

| Grant | Scope | Rights |
| ----- | ----- | ------ |
| workspace | folder, recursive | read, write (never below a `.git` directory), watch |
| file | exact path | read, write (autosave), watch; the image, audio, and video files in its folder tree load as document assets (see below) |
| export dir | folder, recursive | write (never below a `.git` directory), and delete what a previous export into that folder recorded |
| export file | exact path | write only |

Grants are minted only from backend-observed events, never from a bare
webview-supplied path:

- CLI launch arguments (every folder and file the launch names, the `export` subcommand's `--format` and `--out`, the `serve` subcommand's `--host` and `--port`)
- Drag-and-drop onto a window: the OS hands the dropped paths to the
  backend, and the renderer never sees them. On Linux that alone is not
  enough. WebKitGTK serves the page's own drags through the same GTK drag a
  file manager uses, and wry reads any `text/uri-list` that reaches the
  webview as a file drop without asking where the drag came from, so a page
  that writes `file:///home/user` into `dataTransfer` in a `dragstart`
  listener and is dropped on itself would name the folder the drop handler
  grants. The backend therefore asks GTK at every `drag-motion` whether the
  drag began in this process (`gtk_drag_get_source_widget`, which answers
  only for drags GTK itself started) and refuses the drop when it did
  (`src-tauri/src/windows/drag_source.rs`). Windows and macOS read only the
  OS file list (`CF_HDROP`, `NSFilenamesPboardType`), which a page cannot
  write.
- macOS `RunEvent::Opened` and second-instance launches, under the same
  per-path rules as a cold start
- Native pick dialogs run in Rust (`src-tauri/src/commands/pick.rs`): Open
  Folder, Open File(s), a new document's Save As, export Save As, website
  export destination
- Session restore: at startup the backend reads the persisted settings store
  itself and grants the previously open tabs and recent files
- `glyph mcp`'s `--vault` roots, or without them the same settings seed,
  re-read before each tool call, and, without `--vault`, any folder a tool
  names that the user then allows in the MCP client (see
  [MCP server](#mcp-server-glyph-mcp))

A launch can name several paths (a file manager expands `%F` to every selected
file). Each one is classified on its own before anything is granted: a path
that is unsupported, missing, or not valid Unicode is reported on stderr and
skipped, never granted, and never stops the paths after it. The backend reads
the arguments from the process itself (`launch_args.rs`, `cli.rs`), so no
plugin and no renderer-callable command parses them.

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
nothing. The same holds for `set_window_files` and `set_window_unsaved`: the
paths they carry are reports, published for `glyph mcp` to read (see
[MCP server](#mcp-server-glyph-mcp)), and never become readable or writable
by being reported. `take_pending_opens`, which a window calls on mount and
whenever the backend nudges it, takes no path at all: it hands back the opens
the backend already granted and queued for that window, and a window can take
only its own queue. The nudge event itself carries no path.

Workspace and file grants are also mirrored into Tauri's runtime
asset-protocol scope so `asset://` image URLs resolve only inside granted
locations (the static scope in `tauri.conf.json` is empty). The asset
protocol echoes the window origin in `Access-Control-Allow-Origin`, so the
page can read what it serves: the asset scope is read access.

A loose file's relative images and media sit outside its exact-path grant
(#670), so there the asset scope reaches one step past the read rule.
Granting a loose file (opened, saved under a new name, or restored at launch
from open tabs and recent files) records its folder, and
`allow_document_asset` mirrors one path at a time into the asset scope when,
after symlinks resolve, it is an existing image, audio, or video file (the
`image` and `media` lists in `extensions.json`) inside that folder or below
it. Tauri's scope matches escaped paths only, so the extension rule cannot be
a scope pattern; media the lists do not name still loads inside a workspace,
but not beside a loose file.
The registry itself gains nothing: `read_file` and every other gated command
keep the exact-path rule for the file's neighbours. The folder is recorded
where the grant is minted, so the command checks a rule rather than minting
one. On the rendering side, `..` in a reference stops at the drive, verbatim
prefix, or UNC share, so a document cannot turn a relative path into a
request to another host.

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
and files: <path>`), which never echoes the grant list. On Windows, a path
refused as a network share or a device says so instead, before anything is
looked up (see "Network paths" below).

| Command | Check |
| ------- | ----- |
| `read_file`, `check_path_exists`, `read_directory`, `list_markdown_files` | readable. `read_file` also refuses a document over 64 MiB, judged from its metadata before any of it is read: the whole document crosses IPC and sits in the renderer's editor, so this is the bound on what one file can make the app hold. `read_directory` also takes the window's plugin file type extensions, judged after the grant and refused unless each is lowercase ASCII letters and digits. They only add entries of the readable directory to its listing. That lets a renderer list, in one call, every file there with a plain extension, where before it could only probe names with `check_path_exists`; each such file was already readable through `read_file`, and nothing is granted |
| `document_path` | readable, a Save As target included, whose picker grants it as a loose file. It answers with the one spelling tabs hold: no `\\?\` prefix, and the casing and normalization form on disk, for a path that differs from what it resolves to by no more than those. Any other path, one through a link, a mapped drive or a short name, keeps the spelling it arrived with. What it reveals about a granted path is the name `read_directory` would list. Nothing is granted, and the spelling gates nothing: every later command checks whatever path it receives |
| `search_workspace` | readable. The walk below it skips hidden names and follows no link, like every workspace walk |
| `allow_document_asset` | an existing image, audio, or video file, judged after symlinks resolve, inside the folder of a loose file (opened or saved under a new name); mirrored into the asset scope only |
| `vault_snapshot`, `vault_refresh`, `vault_backlinks`, `vault_resolve`, `vault_query`, `vault_paths_with_tag` | granted workspace, not merely readable: the index is per workspace, and a readable check would also accept every directory inside one, letting a caller cache an index per subdirectory. The second path argument is answered from the index in memory, never read from disk, so an ungranted one returns nothing rather than content |
| `vault_forget` | none, because nothing is looked up: the path is compared with the roots the store holds, as their indexes were built with them. It hands nothing back and only drops an index the process already built, so the worst a renderer can do with it is make the next snapshot rebuild from disk. A closing window releases its index the same way, from the paths it reported, and a workspace whose folder is gone is still forgotten |
| `write_file`, `write_binary_file`, `create_dir_all` | writable. No grant covers a write into a `.git` directory: git reads its hooks and the `origin` URL from there, so a write into it is code the user's next commit runs, or a remote the sync token would be sent to. The name is judged without regard to case, as git finds the directory on a volume that ignores case. An exact-file grant is held to it as well as a recursive one: `open_in_new_window` mints one for any file a workspace grant reads, and the settings seed mints one for every `recentFiles` and `openTabs` entry, both of which a renderer can name |
| `copy_file` | source readable and destination writable |
| `prune_export_dir` | the output directory must be writable, and each entry read back from its manifest must be plain path segments, none of them `.git` in any case, whose parent still canonicalizes inside that directory (so a hand-edited manifest cannot delete outside the export, and cannot delete the repository files of an export folder that is a checkout of the site). A `written` list naming `.git` fails the command before anything is removed or recorded: nothing below `.git` is ever written, so the claim is not the export's, and the manifest never carries it. The manifest is neither read nor replaced when it, or the `.glyph` folder holding it, is a link: the output directory is checked, but a link below it leads anywhere. A manifest that cannot be read or parsed is left as it is and nothing is pruned. A new one is written to a staging file of its own beside it, opened only if nothing holds that name, and moved over the old one in one step. The list of files the export failed to replace, like the list of files it wrote, can only spare a manifest entry, never name something else to remove. An entry that differs from a listed name only in case, Unicode normalization form or separators is opened beside that name to see whether the two are one file (the volume decides, not the fold); both paths are confined as above, and nothing but that yes or no comes of it. The reason handed back names the first entry that could not be removed, quoted and escaped, because that name comes from the manifest and ends up in the app's notice and on stderr |
| `pick_export_dir` | `root` must be a granted workspace, checked before the dialog opens. It only decides whether the folder the user then picks is refused for resolving inside that workspace; the grant is for the picked folder alone, so naming another root gains a renderer nothing it could not already write |
| `pick_save_document`, `pick_move_dir` | `default_dir`, the folder the dialog opens in, must be a granted workspace when one is given, checked before the dialog opens. A native dialog resolves that folder as it opens, before the user chooses anything, and on Windows resolving a network path connects to the host it names. A folder that passes is handed on as the renderer spelled it rather than canonicalized, since the dialog cannot open a `\\?\UNC\` path. `pick_save_document`, a new document's Save As, grants the file the user picks as Open File grants one (exact read, write and watch, and the media in its folder as assets), though it may not exist yet; a folder, a link to nothing, or a name inside a `.git` directory is refused. The grant is minted when the user picks, not when the document is written, so a file picked to be replaced stays readable even if the save then fails or the tab was closed while the dialog was open. `pick_move_dir` mints none |
| `pick_save` | no starting folder: an export's dialog opens wherever the platform opens it. The grant it mints is for the file the user picks, to write only |
| `watch_file`, `watch_directory` | readable (unwatch stays open; it only drops a watcher). A directory watch does not follow symbolic links, so a link to `/` or to the home folder inside a workspace puts no watch on the tree behind it; followed, it would take one watch per directory there and exhaust the user's quota. The `glyph serve` watch keeps the same rule |
| `create_note`, `create_canvas`, `create_folder` | `root` must be a granted workspace and the target directory canonicalizes inside it; a network or device path is refused before that lookup. The entry takes the first default name nothing holds, and a link holds its name even when its target is missing, so creating never writes through one |
| `rename_path`, `duplicate_path`, `move_path`, `delete_path` | `root` must be a granted workspace and the entry itself canonicalizes strictly inside it (a network or device path is refused before that lookup, for a move's destination too; a trailing `..`, the root itself, or a symlink resolving outside is refused; `duplicate_path` refuses a folder containing a symlink rather than copying its target). `rename_path` and `move_path` also rewrite links in the workspace's own indexed notes and canvases, each write passing `ensure_writable`; a link or canvas card target that resolves outside the workspace is never rewritten or probed on disk, a file changed since the plan read it is left as it is, and `dryRun` reads without writing. The name a copy, a rename, or a move lands on is picked the way a new entry's is, so it is never one a link holds. Neither the entry nor its destination may sit inside the workspace's `.git` directory, and the name a rename lands on may not be `.git` itself, in any case: a folder built with ordinary writes and renamed `.git` would make its `hooks` git's own, and a file so named is a gitfile that sends git to whatever directory it names (a note keeps its extension, so `.git.md` is what it lands on). `relink::plan` refuses both ends of a move that name `.git` as well, so no caller of `relocate` lands there. `rename_path` also takes the window's plugin file type extensions, judged after the grant and before the entry is looked up, and refused unless each is lowercase ASCII letters and digits. A typed name ending in one splits there like a document's, so a note renamed `drawing.excalidraw` lands on that name. The list widens nothing: the entry stays in its folder under the checks above, and every name it can land on is one `write_file` could already write there |
| `request_open` | folders only; the path must already be a granted workspace root |
| `open_in_new_window` | readable |
| `reveal_path` | readable, checked before the file manager is asked to show the path. A file just exported holds only a grant to write, so it is not revealed. It stands in for the opener plugin's `reveal_item_in_dir`, which the capability does not grant (see [Plugin permissions](#plugin-permissions)) |
| `workspace_resolve` | a network or device path is refused before anything is looked up; a local folder needs no grant. The probe behind the one-folder-one-workspace rule reads no content and writes nothing: it reports whether the folder sits in a git repository and whether an ancestor holds `.glyph`. It does look the folder and each ancestor up, and on Windows looking a network path up connects to its host |
| `workspace_get_last_file`, `workspace_set_last_file` | granted workspace. `.glyph/state.json`, `.glyph/config.json` (the Cloud Sync settings and the plugin settings below), and the `.gitignore` written beside them are read and written only when neither `.glyph` nor the file itself is a symbolic link, a dangling one included: a cloned workspace can ship either one pointing outside itself. A JSON object behind such a link would parse as a config or a state, and so be replaced, unless a key those formats define holds a value of another type (unknown keys are ignored, and a file that fails to parse is left as it is). `.glyph/site.json` (the Website tab) is not one of these: it is read and written through `read_file` and `write_file`, so the grant check decides |
| `workspace_get_plugin_settings`, `workspace_set_plugin_settings` | granted workspace, and a well-formed plugin id (it becomes a key in the committed `.glyph/config.json`). The settings are an opaque JSON object capped at 64 KiB per plugin; nothing in the backend treats a value as a path. The symbolic-link refusal in the row above applies |
| `create_workspace_file` | `root` must be a granted workspace. The path is workspace-relative (`..`, a drive letter, or a backslash is refused) and must canonicalize strictly inside that workspace, so a symlink resolving outside it, or into another granted workspace, is refused. A hidden name anywhere in the resolved path is refused too, which keeps `.git/hooks` and `.glyph` out of reach. The file is opened with `create_new`: one that already exists is reported back and never written to |
| `sync_*` | granted workspace; `sync_init_repo` and `sync_set_origin` accept only `https://` without credentials, `ssh://`, or scp-like `user@host:path` remotes, since libgit2 would also take a local path or `file://` (pulling any local repository into a granted workspace) and cleartext `http://`/`git://`. The HTTPS token is bound, when `sync_set_token` stores it, to the authority (host, and port if named) of the remote the workspace is configured with at that moment, and the credential callback offers it to that authority alone: `sync_set_origin`, and `.git/config` with it, can name any `https://` host, and a token sent wherever that points would reach whoever runs it. A token entered before a remote is configured binds to the first `https://` remote it is used against, and a token stored by an earlier build binds the same way at its first use. Changing the remote to another host means entering the token again. The binding is kept in the keychain beside the token, never in a file the renderer writes. A challenge the bound token does not answer fails the fetch or push: the callback never falls back to libgit2's default credential, which on Windows answers with the signed-in account's own credentials (NTLM or Negotiate) to whatever host the remote names. SSH remotes ask the agent as before. `sync_init_repo` also refuses a default branch that is not a valid reference name, since the name is written into `.git/HEAD` as given |
| `install_plugin` | consumes the pending picked folder; no path argument |
| `install_plugin_from_registry` | takes a plugin id and nothing else. The backend fetches the registry index from its fixed URL, finds the entry, downloads the package the entry names (the marketplace hosts alone, a redirect included, 50 MiB at most), and verifies the sha256 and the manifest id before anything is written, so a package that lies about itself never lands on another installed plugin |
| `finish_cli_export` | ends the process, so it is refused unless a CLI export is in progress: the command is registered in every session, and a renderer could otherwise end an interactive one |
| `assistant_tools`, `assistant_tool_call` | the roots and tabs are the calling window's own report, kept only where `ensure_workspace` and `ensure_readable` pass; the active note is compared with those tabs and never looked up; the tool arguments get the same checks as in `glyph mcp`, so a `vault` must be one of those roots and a note or canvas path must be readable and inside it; only read-only tools are dispatched (see [In-app assistant tools](#in-app-assistant-tools)) |

Reading no content does not exempt a command. Looking a path up is itself an
effect on Windows, where it connects to the host a network path names, so a
command that only inspects a path refuses a network or device path first, and
one that only needs it as a key compares it and looks nothing up.

## Website export

The site exporter (`src/lib/export/site/`) decides what a page publishes, and
it publishes no more than the page walk does. A page is generated for every
markdown file the walk finds, and the walk skips hidden names, so a file a
page refers to is copied into the site only when it resolves inside the
exported workspace and no segment of its path below the root is hidden
(`isPublishableAsset`). That holds for every kind of reference, a link, an
image, a video or audio source, a poster, or an inline SVG image, and for the
favicon and social image `.glyph/site.json` names. A cloned README's
`[config](.git/config)` or `![](.env)`, and an embed climbing into another
open workspace (`![](../../private/diagram.png)`), are left in the page as
written, so the reference is broken in the export rather than a file
published by it, and nothing is copied for them.

This is a rule about documents, not about the renderer. A compromised
renderer already reads every granted file through `read_file`, so `copy_file`
keeps checking its source as readable and its destination as writable and
would gain nothing from a root argument. What it writes is still bounded by
the export grant, which never covers `.git` below the output folder.

## Content Security Policy

`tauri.conf.json` replaces the previous `default-src *` policy with
`default-src 'self'` plus narrow carve-outs. Each exception exists for a
feature:

- `connect-src https: http:` stays broad only because the Ollama server URL
  is user-configurable to arbitrary LAN hosts (plus update checks and the
  plugin marketplace over HTTPS). A streamed reply is read no further than
  16 MiB, a line no further than 1 MiB, and an error body no further than
  64 KiB, so a host the user named cannot grow the renderer without end.
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
  An AI reply loads an image only when the document it was asked about
  already named that URL, compared after the renderer's percent-encoding:
  the reply is shaped by that document, so a URL the model composed would
  be a channel for its contents, while a quoted one carries nothing the
  document view would not already fetch. The URLs are read from the
  document when the reply is requested and kept on the reply, since the
  chat outlives a switch to another document. A note the assistant read
  through a tool adds none (see [In-app assistant tools](#in-app-assistant-tools)).
  Any other image is shown as its alt text and URL. Mermaid's on-screen SVG goes through DOMPurify
  before it is put in the document, as the page renders already did.
- `object-src 'none'`, `frame-src 'none'`, `base-uri 'self'`, and
  `form-action 'none'` close the remaining injection sinks.
- A link a document wrote opens in the system handler only behind the
  external-link prompt (when the setting asks for one), through one path for
  a markdown link and a canvas link card alike. A canvas card whose URL is
  not one of the opener's schemes (`http`, `https`, `mailto`, `tel`) renders
  as text and carries no link into an export. A wikilink opens only a file
  the workspace listing holds, since its target rides on a data attribute
  raw HTML can forge, the way embeds and previews are already gated. The
  sanitizer drops `accesskey`, which would bind a document's link to a
  keyboard accelerator. Sentry breadcrumbs (opt-in telemetry) drop DOM
  breadcrumbs, which name the clicked element by the document's own words,
  and the raw arguments of console breadcrumbs, which carry paths.

The dev CSP is identical plus the Vite dev server and HMR websocket on
`localhost:1420`.

## Navigation

The CSP says what the page may load; it says nothing about where the webview
may go. Every link in a document goes through the link component, which
prompts before it hands the URL to the system browser, but markup reaches the
page by other routes too: Mermaid keeps a `click A href "..."` under its
strict level as an SVG anchor, an HTML label can hold one, and a D2 shape's
`link` renders as one. None of those passed through the link component, and
wry allows any top-level navigation by default, so a click replaced the app
with the remote page, in a window with no address bar, where the init script
that hands a spawned window its path (`window.__GLYPH_OPEN__`) is readable.
Two layers close this:

- **Diagram links are inert.** The Mermaid and D2 sanitizers forbid `<a>`
  (`src/plugins/core/mermaid/mermaidRender.ts`,
  `src/plugins/core/d2/d2Render.ts`), on screen and in the static renders
  the exports, the OS previews and the web viewer use, so a diagram link
  renders as its label with nothing to click. That is the intended
  behaviour, not a gap: a diagram is drawn from document source, and a link
  in it would open with no prompt.
- **The host refuses the navigation.** `src-tauri/src/navigation_runtime.rs`
  registers a plugin whose navigation handler runs for every webview, the
  main window and the ones `windows_runtime.rs` spawns alike, and allows
  only the app's own origin (`tauri://localhost`, or `http://tauri.localhost`
  on Windows and Android) plus, in a dev build, the origin of the dev server
  `tauri.conf.json` names (`tauri::is_dev()` decides, so a release build
  allows no `localhost:1420`). Anything else that reaches the page
  (`https:`, `file:`, `data:`, `javascript:`) is cancelled before it loads,
  so a stray anchor does nothing.

## Windows Explorer preview handler

The preview handler (`src-tauri/crates/preview-handler/`) renders markdown
inside Explorer's preview pane. Its exposure differs from the app's in one
way that matters: **selecting** a file renders it. No open, no double-click,
so a hostile document in a Downloads folder is rendered by hovering the arrow
keys over it. What holds it in:

- **The same sanitizer.** The page reuses `renderPageHtml`, so document HTML
  goes through the `rehype-sanitize` schema the app uses. Nothing document-
  authored reaches the DOM unsanitized.
- **No network.** The page's CSP is `default-src 'self'` with images also
  allowed from the previewed file's own folder, which the host maps to
  `glyph-document.example` read-only (`DENY_CORS`: images load, `fetch` does
  not). Remote images are replaced by their alt text before they reach the
  DOM, so a document cannot phone home or leak the viewer's IP by being
  selected. SmartScreen reputation checks are off for the same reason.
- **No navigation.** The Rust host cancels every navigation that is not the
  preview page or one of its anchors, so links, including a relative
  `other.md` that would otherwise resolve onto the preview host, are inert.
  New windows are refused, host objects, dev tools and browser accelerator
  keys are off.
- **A size cap.** Files over 2 MiB get a notice instead of a render, so a
  large file cannot stall Explorer's pane. Quick Look and the web viewer
  apply the same cap, as does the app's Copy Share Link, all reading it
  from `src-tauri/preview.json`.
- **Process isolation.** The handler runs in Explorer's `prevhost.exe`
  surrogate, not in Explorer, and the WebView2 renderer keeps its own sandbox.
  A crash or a hang takes down the surrogate only.

The handler opts out of the surrogate's low integrity level
(`DisableLowILProcessIsolation`), because WebView2 fails with `E_ACCESSDENIED`
at low IL. It therefore runs at medium integrity, with the user's own rights,
which is the same level the app itself runs at. What it does with them is
narrow: it opens one file, reads at most 2 MiB of it, and maps that file's
folder into the view read-only.

## macOS Quick Look extension

The Quick Look extension (`src-tauri/macos/quicklook/`) renders markdown when the user presses Space on a file in Finder. Like the Windows handler, a single keypress on a hostile file in Downloads renders it, so it carries the same controls, enforced in Swift rather than only by the page:

- **The same sanitizer.** It loads the same `src/preview` page, so document HTML goes through the app's `rehype-sanitize` schema.
- **No network.** The page's CSP allows only its own files, `data:` images, and `glyph-preview://document` (the previewed file's folder). Independently, a WebKit content rule list blocks every load that is not `glyph-preview:`, `data:` or `blob:`, so a CSP gap still cannot reach the network. Remote images become their alt text before they reach the DOM.
- **No navigation.** The navigation delegate allows only the preview page and its in-page anchors, so every link to anything else is inert; a link to the page itself reloads it and the document is shown again. There is no `uiDelegate`, so a link that asks for a new window opens nothing, and the page gets no script message handler: the host posts the document in, the page never calls out.
- **A size cap.** Files over 2 MiB get a notice instead of a render, so a large file cannot stall Quick Look.
- **Process isolation.** The extension is its own sandboxed process, launched by Quick Look, and WebKit's web content process keeps its own sandbox. A crash takes down the extension only.

The extension's sandbox carries three entitlements (`GlyphQuickLook.entitlements`):

- `com.apple.security.app-sandbox`, which PlugInKit requires of every extension.
- `com.apple.security.network.client`, because a sandboxed `WKWebView` cannot start its web content process without it. The content rule list above is what keeps the network closed.
- `com.apple.security.temporary-exception.files.home-relative-path.read-only` for `/`, because Quick Look grants the previewed file alone and relative images live beside it. This is a read of the user's whole home folder, which is broader than the Windows handler's folder mapping. What narrows it is the only code that uses it: the scheme handler serves `glyph-preview://document/` from the previewed file's own folder, refuses `..`, empty segments and symlinks resolving outside that folder, and serves only image types. The page itself cannot name a path outside that folder, and there is no channel out for anything it could load. The exception does not bypass macOS privacy controls: an image beside a file in Desktop, Documents, Downloads or iCloud Drive triggers the system's one-time folder access prompt, attributed to Glyph, and if the user declines, those images do not load. Files outside the home folder (external volumes, `/tmp`) never get their images.

The app and the extension are ad-hoc signed; there is no Developer ID or notarization. That changes nothing about the extension's sandbox, which macOS enforces from the entitlements in the ad-hoc signature, but it means Gatekeeper does not vouch for the download: users trust the release the same way they trust the rest of the app today.

## Web viewer

The web viewer (`src/web/`, built by `pnpm build:web` and published by the
`glyph-md/view` repo at `https://glyph-md.github.io/view/`) runs the same
preview page in an ordinary browser tab. Its exposure is the widest of the
three: a shared link carries a whole document in its URL fragment, so
**opening a link** renders a document anyone could have written, on a public
origin, in whatever browser the reader uses. There is no native host, so every
control is the page's own:

- **The same sanitizer.** Documents go through `renderPageHtml` and the app's
  `rehype-sanitize` schema, as in the OS previews.
- **No network.** A meta CSP, first in the page's head, allows the page's own
  files, `data:` images and fonts, `blob:` images, and no media, workers,
  frames or objects. It is the only layer: nothing beneath it blocks a
  request it lets through, so the WebKit smoke suite opens a hostile document
  in the built page and checks that nothing reaches another origin (and, with
  the CSP removed, that the same document does). `<img>` elements become their
  alt text before they reach the DOM, unless a folder the reader picked holds
  them (below); SVG images, posters and CSS `url()` are left to the CSP.
  `no-referrer` keeps the page URL out of `Referer`, DNS prefetch is off, and
  nothing on the page reports telemetry, so the document never leaves the tab.
- **Images only from a folder the reader picks.** A page never learns where a
  picked file sits or what is beside it, so a document with relative images
  offers **Show Images**, a `webkitdirectory` file input. The opened file is
  recognised in the picked folder by its name, size and time, and a relative
  `src` with no `..` maps to the image at that path below it (from the top of
  the folder for a shared link, or a file the folder does not hold). It is an
  exact match, so an encoded `%2E%2E` or a leading `/` finds nothing, even for
  an image above the document in the same pick, and only image types map.
  Each mapped file loads through a
  `blob:` URL the page makes for it, which is all `blob:` in the CSP is for.
  A document cannot name one in an `<img>`, since only relative sources map;
  an SVG image or CSS `url()` would have to guess its random name, and would
  only show the reader's own image again. A `blob:` URL is memory in the tab,
  never a request. The URLs are revoked when the viewer shows another
  document or the empty state, a pick that lands after the document changed
  is dropped, and nothing about the folder is kept. Remote images stay alt
  text with or without a folder; the smoke suite picks a folder and checks
  that its images load while nothing reaches another origin.
- **No navigation.** One click handler covers every link in the document,
  an SVG anchor included should one reach the page (the Mermaid render drops
  its own): in-document anchors scroll without touching the fragment that
  holds the document, web links open in a new tab with no opener and no
  referrer, `mailto:` keeps its default, and everything else (a relative
  `other.md`, a broken wikilink) is inert.
- **A size cap.** Files over 2 MiB get a notice without being read. A link's
  prefix, alphabet and length are checked before decoding, and it is inflated
  in small chunks that stop once the document passes 2 MiB, so a short link
  cannot expand into gigabytes.
- **Isolation.** The browser's sandbox is the process boundary. The page
  stores nothing (no cookies, storage or service worker), and the document
  area is `contain: layout paint`, so document CSS cannot draw over the
  viewer's own controls.

## Plugin permissions

`capabilities/default.json` grants no permission set whose members resolve
renderer-supplied paths: the dialog, filesystem, opener, and store plugins get
the exact commands the frontend calls instead of their `default` sets. The
remaining default sets (`core`, `os`) reach no file. There is no `http`
permission: the marketplace download runs in Rust
(`install_plugin_from_registry` in the table above), which fetches the
registry index from its fixed URL and follows the entry to a package on the
marketplace hosts alone, so the renderer never names a URL.

- **Clipboard.** `clipboard-manager:allow-read-text`, for the editor's
  context-menu Paste (`src/lib/editorContextMenu.ts`): `execCommand("paste")`
  is blocked in the webview, and WebKit gates `navigator.clipboard.readText()`
  behind a second native confirmation, so the item reads the native clipboard
  through the plugin. The command takes no argument and no path, but nothing
  ties it to the menu item: a compromised renderer can read whatever the user
  last copied, at any time, a password manager's entry included. Accepted,
  since paste has to read the clipboard and this is the only read that works
  without the extra prompt.
  `clipboard-manager:allow-write-text` backs Copy Share Link
  (`src/hooks/useShareLink.ts`): it runs from a native menu item, a click that
  carries no user activation, and WebKit refuses
  `navigator.clipboard.writeText()` without one. Every other copy still uses
  the browser clipboard API. Nothing ties the write to the command either, so
  a compromised renderer can replace what the user copied, say an address
  they are about to paste. Accepted: such a renderer already reads the
  clipboard through the grant above, and WebView2 lets page script write it
  without a gesture while the window has focus.
- **Dialog.** Desktop holds `dialog:allow-message` alone (it backs `ask`).
  The plugin's `open` command adds whatever the user picks to the fs and asset
  scopes, so `dialog:allow-open` lives in `capabilities/mobile.json`
  (`platforms: [android, iOS]`), where the OS document picker replaces the
  Rust pickers. All desktop pickers run in Rust.
- **Filesystem.** No `fs:` permission on desktop; file I/O goes through the
  gated Rust commands. The plugin lives in `capabilities/mobile.json`, gated
  to Android and iOS, where it reads the sandboxed `content://` URIs the Rust
  commands cannot open (`src/lib/documentContent.ts`), as `fs:default` plus
  `fs:allow-read-text-file`. In tauri-plugin-fs 2.6.0 the `default` set is
  `create-app-specific-dirs` (`mkdir`, scoped to the app-specific directories
  themselves), `read-app-specific-dirs-recursive` (`read_dir`, `read_file`,
  `read_text_file`, `read_text_file_lines` and `exists` under the
  `scope-app-recursive` scope: `$APPCONFIG/**`, `$APPDATA/**` and the other
  app-specific directories) and `deny-default` (the webview's own cookie,
  cache and storage paths under `$APPLOCALDATA` are denied on Windows and
  Linux). It carries no write command, so a renderer holding it can read
  everything under the app directories, installed plugin code and
  `settings.json` included, and create those directories, but cannot change
  a file there. The plugin unions the global and per-command scopes for every
  command it exposes, so any `fs:allow-write-*` added beside `fs:default`
  would be scoped to those same directories, and plugins are installed under
  `app_config_dir()`: a compromised renderer could then overwrite installed
  plugin code and have it loaded on the next launch, bypassing the grant
  registry entirely. That is why desktop carries no `fs:` permission at all.
  A unit test in `lib.rs` fails if any `fs:` permission returns to the
  default capability (#698).
- **Opener.** `opener:allow-open-url` with the `allow-default-urls` scope
  (`mailto:`, `tel:`, `http://`, `https://`), which links and the update
  notices use. Not `opener:default`: that set also carries
  `reveal_item_in_dir`, which takes any path the renderer names, under no
  scope, and checks that it exists before it asks the file manager for it. On
  Windows that lookup connects to the host a network path names. "Show in
  system explorer" calls `reveal_path` instead (in the table above), and a
  unit test in `lib.rs` fails if the capability gains another opener
  permission.
- **Store.** No `store:allow-load`: `load` resolves the requested path against
  AppData, and an absolute path replaces the base, so it would read or
  overwrite any JSON file the user can write. The backend opens
  `settings.json`, `plugins.json`, and `workspace-sessions.json` in
  `setup.rs`; the renderer attaches with `getStore` and holds the per-key
  commands only.
- **Desktop.** `capabilities/desktop.json` holds `window-state:default` alone.
  There is no CLI plugin: nothing in the renderer needs the launch arguments,
  so there is no command that returns them.

## Git repositories in a workspace

A folder can carry a git repository, and a repository names paths of its own:
the target of a `.git` file, a `commondir` or `gitdir` file, alternate object
stores, and paths in its config (`core.worktree`, `core.excludesfile`,
`core.attributesfile`, an included file, a remote that is a path). libgit2
resolves them, and on Windows resolving a network path connects to its host,
which can hand it the user's credentials. This takes no compromised renderer:
the folder only has to be opened, and a downloaded or unzipped one names any
host it likes. libgit2 has no switch that forbids it.

- **Opening a folder reads none of it.** `workspace_resolve`, which runs on
  every folder a window opens, asks only whether the folder or an ancestor
  holds a `.git` entry. It opens no repository, so nothing a repository points
  to is looked up.
- **Cloud Sync judges the repository first.** On Windows every `sync_*`
  command that hands the workspace to libgit2 first reads those files as text
  and passes each path they name to the registry's network-path check, which
  looks nothing up. That is every sync command but the config and token ones,
  and it includes the two that run unprompted when a workspace opens
  (`sync_repo_present`, `sync_default_author`). A repository naming a network
  or device path is refused with an error, unless a grant already sits on that
  share.
- **Submodules get the same check.** Status, staging and checkout open each
  submodule, so `sync_status`, `sync_run` and `sync_commit_config` also judge
  `.gitmodules` and the `.git` of every submodule libgit2 lists, and of
  theirs, wherever its path leads. Listing them opens none. A repository that
  merely sits in the working tree, in none of the places libgit2 learns
  submodules from, is not judged: status does not open it, and staging fails
  on it before opening it.
- **A pull removes before it writes.** A fast-forward checks out the
  upstream tree while the branch still names the old commit and moves the
  branch afterwards. libgit2 decides what to delete by diffing the two, so a
  symlink entry that the new commit replaces with a directory is unlinked
  before the files below that name are written. With the branch moved first
  there is nothing to diff, the link stays, and those files land wherever it
  points, which the remote chose when it committed the link. A merge checks
  out against the old tree by construction.
- **The config is judged as text, not parsed.** A value that begins with two
  path separators is refused under any key, once quotes are dropped and an
  escaped backslash is read as one. How libgit2 joins a value continued over
  several lines is not reproduced: the backslash that continues a line counts
  as a separator itself, so a path split there is refused as well. A config
  with an `[include]` or `[includeIf]` section is refused outright: the
  included file would need the same check, and libgit2 resolves the path to
  it first. A repository that shares settings through `include.path`
  therefore cannot be synced from Glyph on Windows.
- **A pointer libgit2 would place differently is refused.** Only an absolute
  path and a plain relative one are followed to the files behind them. A
  drive-relative or rooted path, one behind the `\\?\` prefix, an alternate
  relative to the process's current folder, and a link standing in for `.git`
  or for one of these files are refused unread.

The files are judged and then read again by libgit2, so the check holds for a
folder at rest, not against another process rewriting them in between. The
machine's own git configuration (global, system) is the user's and is not
judged.

## MCP server (`glyph mcp`)

`glyph mcp` serves the vault index to an MCP client over stdin and stdout. It
is its own process and never builds the app: no webview, plugin, or Tauri
command exists in it. Its caller is the client, and through the client a
model that reads untrusted note content, so every tool argument is treated
the way a renderer-supplied path is.

- **Roots.** The vaults come from `--vault` or, without it, from the persisted
  settings, which the server re-reads before each call with the trust the
  app's startup seed already gives that file. A tool's `vault` argument picks
  among those roots. Without `--vault`, it can also name another folder by
  absolute path. The server then sends the client an `elicitation/create`
  question showing the folder's resolved path, and serves the folder for the
  rest of the session only on `accept`. The answer comes from the client,
  never from the model. The grant is the path the user saw, not resolved
  again, so a link swapped in while they decide leads nowhere. The folder is
  resolved once, to match it against the vaults already open; past that,
  nothing is looked up on disk until the server knows it can ask. The path
  comes last in the question, after everything the user is told, so a folder
  named to read like a sentence of its own cannot rewrite what is asked, and a
  path holding a character that could hide or reorder text on the screen (a
  control character, a line separator, a format character such as a
  zero-width space, a bidirectional override or an invisible tag) is never
  put to the user at all. Look-alike letters from another script are not
  caught; the client shows the path as spelled.
- **Network paths.** On Windows, the grant registry refuses a path that names
  a network share or a device before it resolves anything, whether a tool
  argument, a renderer command, or the settings seed handed it over, unless a
  grant already sits on that share: resolving one connects to the host, which
  can hand it the user's credentials. The check does not stop at the prefix
  Rust's `Path` parses: the NT prefix `\??\` is refused whole, local folders
  included, and so is a path opening with two separators that `Path` finds no
  server and share in (`\\host\\share` still reaches `\\host\share`), even on
  a share a grant sits on. Neither spelling comes from a picker, a drop, or a
  launch argument.
- **Every path goes through the registry.** A note reference that names a
  path, `resolve_link`'s `from`, `read_canvas`'s `path`, `export`'s `out`, a
  note a write tool changes, and the destination of a rename or a move pass
  `ensure_readable` or `ensure_writable` before anything is read or written.
  A wikilink target resolves only to a note the index already holds, and the
  index keeps its walk rules: no symlink out of the vault, no hidden folder,
  nothing over 5 MB. What a note can put into the index is bounded too: the
  first 2,000 wikilinks and 2,000 markdown destinations of a note are kept and
  a note past that is reported as a partial index, a missing target is listed
  once per note, and the list of links to missing notes stops at 10,000 with
  the same report. The link scan itself is linear in a line, so a line as long
  as the file cap allows is parsed in a bounded time. Workspace search leaves
  files over 5 MiB unread and says how many.
- **Effects.** `export` writes only inside the vault it reads, to a name
  carrying the format's extension, so it cannot replace a note; the name
  may not be a link either, since the write would follow it to whatever
  note a cloned vault pointed it at.
  `open_in_glyph` hands the app a path the server can already read, the way a
  file manager would. Five tools change notes: `patch_note`, `set_property`,
  `update_task`, `rename_note` and `move_note`. Every other tool is read-only.
- **Write tools are off until turned on.** Each of the five has its own switch
  in Settings, one boolean per tool under `ai.agentWriteTools` in
  `settings.json`, so two windows changing different tools merge instead of
  one overwriting the other. The server reads them again before every listing
  and every call. A tool that is off is left out of `tools/list`, and the
  check that matters is in dispatch: a call to a name the client was never
  offered is refused the same way. The folder prompt names the write tools
  that are on, since allowing a folder lets them change notes in it.
- **A write stays inside the vault and inside the edit.** The target passes
  `ensure_writable`, and a rename or a move checks its destination against the
  grants before it asks the disk anything about it, then against the vault the
  call reads, which the grants alone do not ensure once a session serves
  several. The edit is worked out from the file as it is on disk, and written
  only if the file still holds exactly that; otherwise nothing is written and
  the caller is told to call again. A result past the 5 MB the index reads is
  refused.
- **An edit the parsers cannot place is refused, not guessed.** Sections are
  cut by the renderer's embed slicer, which follows unindented `#` headings
  and matches fences by character. `patch_note` refuses a section in which
  CommonMark reads a heading the slicer does not, or the reverse (an
  underlined or indented heading, hashes alone, a `#` line inside raw HTML or
  display math, a fence closed by length or by the end of the list item
  holding it), because its bounds would not be the rendered note's.
  `set_property` refuses a block holding a bare carriage return or a NUL,
  where the parser's line count and the slicer's part ways, checks that the
  key sits on the line the parser named and that the lines it leaves behind
  an entry are comments to the parser too, and parses its result again: every
  other property has to read as it did, and everything from the closing fence
  on has to be untouched. `update_task` reads fences by length and at any
  depth. A rename or a move
  refuses a destination that exists and one the index would not read, and a
  link rewrite that stops partway is reported with the note it stopped at,
  never as a success. The one destination that may exist is the note itself:
  where the filesystem ignores case, a note's own name in other letters
  reaches that note, and is taken for a rename in place only when the two
  paths are one file and its folder lists no entry spelled the new way.
- **Notes being edited.** The running app publishes, in `open-documents.json`
  in its data directory, the files every window has open and which of them
  hold unsaved edits, from each window's own report. The server reads it at
  the moment a call is about to write, not when the call began, and from
  whichever store directory holds the instance lock; it compares paths
  through the grants as they stand then, a folder allowed during the call
  included. A write to a note with unsaved edits is refused with a message
  that opens `unsaved changes`. A rename or a move is refused for a note open
  in any window, saved or not, because the app would go on saving it under
  its old path, and for a move that would rewrite links in a note with
  unsaved edits. With Auto Reload off, a write to any note a window has open
  is refused, since the window would save its old text back. A running app
  whose list is missing or unreadable, and a lock that cannot be asked at
  all, are treated as not knowing: every write is refused.
- **Stdout** carries JSON-RPC messages and nothing else. The processes the
  server starts get null or captured stdio, never its own.
- **Bounds.** A message over 1 MiB is refused; a listing stops at 200 rows and
  note text at 50,000 characters, and says so.
- **What is open.** `vault_context` reports only tabs and notes the grants
  admit, and nothing at all while the app is closed, which it learns from an
  OS lock the interactive app holds on `instance.lock` in its data directory.

## In-app assistant tools

Two commands give the in-app AI assistant the server's read-only tools,
dispatched in-process through the same registry: `assistant_tools` lists
them, and `assistant_tool_call` runs one call. The call's name and arguments
come from a model that reads note content, by way of the renderer, so they
are treated as both: untrusted model output and renderer input. The commands
exist on desktop only, like `glyph mcp`.

- **Read-only at dispatch.** `assistant_tool_call` goes through
  `dispatch_read`, which refuses every tool that is not read-only before its
  handler runs: `open_in_glyph` starts a process, `export` writes a file, and
  the five edit tools change notes. The refusal holds whatever the agent-tool
  switches in `settings.json` say, and the session it builds turns no edit
  tool on. Listing only the read tools is not the control, since a model can
  call a name it was never offered.
- **The calling window's workspace only.** The roots are the workspace the
  calling window reported with `set_window_workspace`, kept only when it
  passes `ensure_workspace`. Grants are app-wide, so another window's
  workspace is granted too: the scoping comes from the session's roots, among
  which a tool's `vault` argument can only pick, and from the vault a call
  reads through, which refuses an absolute or `..` path into another vault
  before it asks the disk anything, so the refusal is the same whether a file
  is there or not.
  No folder can be added. A `vault` naming any other folder passes the
  network-path check, is resolved once to match it against the roots, and is
  refused, since the session has no way to ask the user for more.
- **The active note.** The renderer names the note in front of the user. It
  is compared with the window's reported file tabs that pass
  `ensure_readable`, never looked up, and dropped when it is not one of them.
  It only picks the default vault and is reported back to the model.
- **Bounds.** The same as for `glyph mcp`: a result over 1 MiB is refused, a
  listing stops at 200 rows and note text at 50,000 characters and says so,
  and a handler that panics is a refusal, not a crash. The call runs on a
  blocking worker, off the main thread. It reads the index the app's watcher
  keeps current, the one the UI reads, so it never walks the vault while
  holding the store's lock the UI's queries wait on; only a first call for a
  vault builds its index, outside that lock.
- **What leaves the machine.** Without tools a question sends the open
  document and a listing of the workspace's files to the configured provider.
  With them the model can pull any note of the window's workspace into the
  conversation, and with a cloud provider that note goes to the provider; the
  latest reply's calls and results go again with the next question, older
  ones only as the reply's text. The AI settings say so, and the switch that
  offers the tools is kept per provider: it is off for the Anthropic provider
  and OpenAI and on for Ollama, whose server the user names, until the user
  sets it. The tools are offered only while the window has a workspace open,
  and a call to a tool the reply was not offered is not run. The switch lives
  in `settings.json`, which the renderer writes; it gates nothing the renderer
  could not already send, since the renderer reads every granted file and
  holds the provider's key. Each call and its result are listed with the
  reply, so the basis of an answer can be checked.
- **Note content is untrusted model input.** A note read through a tool can
  carry text written to steer the model. The tools only read, so the harm left
  is in the reply. The system prompt says that tool results are the user's
  notes and not instructions, which a model may ignore, so nothing depends on
  it. A reply image still loads only when the open document already named its
  URL (see [Content Security Policy](#content-security-policy)); a URL in a
  note the model read through a tool does not count, since the user never
  opened that note, and loading it would let a planted note send what the
  model read to its own host. A link in a reply opens in the system browser,
  never in the app's webview, behind the external-link prompt when that
  setting is on, as before.

## Residual risks

- **An MCP client reads everything in the vaults it is given.** Whatever a
  served vault holds can reach the model; `--vault` narrows it. Without
  `--vault` the server follows the vaults the app has open, including one
  opened after the conversation started.
- **The folder prompt is only as good as the client's.** The model can make
  the server ask for any folder on disk. A client that accepts elicitation
  without showing it to the user, or a user who approves by reflex, gives the
  model that folder until the session ends. Starting the server with
  `--vault` turns asking off.
- **A write tool that is on reaches every note in the served vaults.** The
  toggle is per tool, not per vault or per note, and a model that reads
  untrusted note content can be talked into using it. `--vault` narrows the
  vaults; there is no undo beyond the vault's own version control.
- **The write-tool toggles are renderer-writable.** They live in
  `settings.json`, so a compromised renderer can turn a write tool on for a
  connected agent, against the rule that nothing gating backend behaviour is
  read back from that file. For vaults the app itself has open this gives the
  agent nothing the renderer lacks, since the renderer already writes every
  file under them through `write_file`. It does reach further where the
  server serves what the renderer holds no grant for: a `--vault` folder, or
  one the user allowed in the client. The agent still has to make the call;
  the renderer cannot make it for the agent, only plant text for the model to
  read. Accepted so the toggles sit with the other settings.
- **The unsaved-changes guard is a report, not a lock.** An edit typed in the
  instant before a write is not yet in the published list, and a compromised
  renderer can leave a path out of it. The app keeps an unsaved buffer over a
  change on disk, so in that window it is the agent's write that the next
  save replaces, not the user's edit. Two cases it does
  not see at all: a second Glyph process that could not take the instance
  lock (a debug build, or `open -n` on macOS) publishes nothing, and a write
  landing within the second and a half after the app saved the same file is
  taken by the app for its own save and not reloaded.
- **A replaced destination.** A rename or a move checks that nothing is at
  the destination and renames afterwards, as a rename made in the app does. A
  file created there in between is replaced.
- **A note the assistant reads can steer its reply.** Read-only tools keep a
  planted note from changing anything, but not from shaping what the reply
  says, a link included. A link whose URL carries what the model read opens
  on one click when the external-link prompt is off; with it on, the prompt
  shows the URL first.
- **The assistant's window scope holds against the model, not the
  renderer.** The workspace a window reports is the renderer's word, so a
  compromised renderer can report another granted workspace and have the
  tools read it. That gives it nothing it lacks: `read_file` and the vault
  commands already read every granted workspace.
- **The caps bound the index; they do not make it small.** A workspace at
  the file cap with every note at the link cap is still hundreds of megabytes
  of index, and a search over it reads every file under 5 MiB. Each cap says
  when it was hit, which is what keeps the index honest rather than what
  keeps it cheap.
- **The section check reads line by line.** `patch_note` judges whether a
  section's bounds match the rendered note without building CommonMark's
  block structure. What that cannot settle mostly errs toward refusing. Three
  shapes are known to pass with bounds that differ: fence lines indented four
  or more columns among other fence lines, a lone closing tag on the line
  under a list item followed by a line of bare hashes, and an indented code
  line followed by two lone dashes. Each already renders visibly broken.

- **A token bound on first use.** A token entered before the workspace has a
  remote, or stored by a build that recorded no host, is bound to the
  configured `https://` remote the first time it is used. The configuration
  is renderer-writable, so in that one window a compromised renderer that
  changes the remote before the first sync decides the binding. Accepted so
  existing tokens keep working after the upgrade without being entered again.
- **Check, then write.** A path is checked and then written in two steps, and
  the write follows whatever is at the path by then. A link that appears
  there in between, planted by another process or landing with a sync pull,
  is followed. Closing that window takes writes that refuse a link when they
  open the file, which the commands do not do today.
- **Persisted-session grant staging.** The settings store (`settings.json`)
  is renderer-writable, and the backend seeds grants from it at the next
  launch, so a compromised renderer can stage grants for paths it names
  there. This matches the trust the file already carries (it decides what
  reopens on launch); it is accepted so session restore keeps working, and it
  only matters after the renderer is already compromised.
- **Media beside a loose file.** A compromised renderer can load, and so
  read, every image, audio, and video file under the folder of any loose file
  the session granted, including files saved under a new name and files
  restored at launch from open tabs and recent files, not only the ones the
  document references. A note in the home folder or at a drive root exposes
  the media beneath it, and a staged file grant (above) stages its folder too.
  Accepted so a document opened or saved on its own renders its relative
  images (#670); every other file there stays denied, and a reference that
  climbs above the folder (`../`) does not load.
- **`glyph serve` is an inbound listener.** The one place Glyph accepts
  connections rather than making them. It binds `127.0.0.1` unless `--host`
  says otherwise, answers only to `Host` headers naming itself (so a web page
  cannot reach it by re-pointing its own domain at loopback), refuses hidden
  paths (judged on the request path as `ServeDir` reads it, percent-decoded
  and split on both separators, so `%2eenv` is `.env`), answers every
  request with `Cross-Origin-Resource-Policy: same-origin`, `X-Frame-Options:
  DENY` and `X-Content-Type-Options: nosniff` so a page cannot embed what it
  cannot read, and relies on `tower-http`'s `ServeDir` to keep requests
  inside the output directory. What it serves is still unauthenticated: anyone who can
  reach the port reads the whole exported site, and `--host 0.0.0.0` extends
  that to the network, which is why it is opt-in and warns. Everything in the
  output directory is published, so the CLI refuses an `--out` that contains,
  or is contained by, the folder being served. The site is derived output, not
  the workspace: serving grants no filesystem access back to the renderer.
  What that renderer reports to the terminal (a build warning or failure)
  is printed with control characters escaped: it shows the served workspace,
  so a warning carries file names from it, and a terminal obeys an escape
  sequence wherever it comes from.
- **The web viewer shares an origin.** GitHub Pages serves every glyph-md
  repo under `glyph-md.github.io`, so the viewer's `'self'` covers the other
  sites there, and a script any of them publishes could run on the viewer's
  page. The viewer holds no secret and no session, so such a script reaches
  only the document in the tab and, once the reader picks a folder for its
  images, every file in that folder: the browser hands the page all of them,
  though the viewer itself opens only the images the document names. A
  subdomain of its own, once the org has a custom domain, separates it.
- **The web viewer can be framed.** A meta CSP cannot set `frame-ancestors`,
  and GitHub Pages sets no headers, so another site can embed the viewer. Its
  actions are Copy link, which copies what the viewer already shows, and
  Show Images, whose picked files stay in the viewer's own origin where
  the framing site cannot read them.
- **A shared document can look official.** It renders on a Glyph URL with the
  styles it brings (`style` is allowed, see `style-src` below), so a link can
  dress up as a Glyph page and point readers at another download. The
  viewer's toolbar stays outside the document's paint area.
- **A heavy shared document can hang the tab.** Mermaid and KaTeX render on
  the main thread, so a link can carry a diagram expensive enough to freeze
  the reader's tab. Closing the tab ends it.
- **A shared document lives in browser history.** The URL is the document, so
  it stays in the reader's history, and in history sync, like any visited
  link.
- **`connect-src` breadth.** Arbitrary `http:`/`https:` hosts are reachable
  for the Ollama integration, so a compromised renderer can exfiltrate what
  it can read. The grants bound what that is.
- **`style-src 'unsafe-inline'`.** CSS injection in rendered markdown remains
  possible; it cannot reach the filesystem.
- **Plugins.** Plugins run sandboxed by default (issue #434): a manifest
  without a `sandbox` flag is isolated in a worker, filesystem reads require
  the declared-and-accepted `workspace:read` permission, the open document
  reaches it only through an export the user runs, and the worker's
  network is fenced to declared `network:` hosts: `http` and `https` to the
  declared host or a subdomain of it, a redirect never followed, and never
  the webview's own hosts, whatever is declared, since the asset protocol
  serves every granted file from `asset.localhost` (or `asset://localhost`)
  and `ipc.localhost` is the command bridge; a plugin that declares
  `network:localhost` for a local server reaches that server alone. The
  manifest parser refuses a `network:` host that is empty, not a plain
  lowercase name, or under `.localhost`. A stylesheet or color scheme a
  sandboxed plugin adds is dropped when it would make requests (`url()`,
  `image-set()`, `@import`: with a selector on an attribute, each one reports
  what the page holds), however the name is spelled: the check reads the text
  with its CSS escapes decoded, since `\75rl(` is still `url(`. Exports carry
  every plugin's styles, so the HTML export, and the styles handed to a
  plugin's exporter, write `</` as `<\/`. CSS reads both the same, and a
  stylesheet cannot end the `<style>` element it is placed in and add a
  script to the exported page (EPUB and the website export write the
  styles to a separate `style.css`). A plugin of either kind may not register translations
  under one of the app's own namespaces, which the consent dialog and the
  external-link prompt read; any other namespace is its to fill. A plugin
  that declares
  `"sandbox": false` still executes in the app context and sees everything the
  renderer sees (the host's own Escape handling and close button on a plugin
  overlay guard against a plugin's bugs, not against a hostile one); that mode
  requires an explicit full-trust consent, persisted per plugin, and
  marketplace packages are downloaded and SHA-256-verified in Rust against
  the registry entry it fetches itself, so a compromised renderer can install
  a reviewed package but never bytes of its own. The app-context API also lets a full-trust plugin
  read the active document, query the workspace index, open workspace files,
  list workspace files in the Files panel, and save a fenced block it renders
  (`updateCode`) back into the document open in the app. None of that adds a
  command: index queries go through the `vault_*` commands, which check the
  workspace grant themselves, an open is an ordinary `read_file`, and a block
  save is the tab's own save through `write_file` on the tab's path, refused
  when the text no longer holds the block the plugin rendered. The paths a plugin
  opens or lists are confined to the workspace in the renderer first, as a
  consistency check rather than the boundary. One that declared
  `workspace:write` can also create a file in the workspace and keep a
  settings object of its own in the workspace's `.glyph/config.json`. Those
  two do add commands (`create_workspace_file` and
  `workspace_set_plugin_settings`, in the table above), and each holds its
  boundary itself: the first never replaces a file and refuses hidden paths
  such as `.git/hooks`, the second writes one size-capped block keyed by the
  plugin's id. Sandboxed plugins get none of it. Core plugins (the compiled-in
  `CORE_PLUGINS` list: D2, Mermaid, math, tags, backlinks, daily notes, and
  theme presets today) are app code shipped in the signed binary: they load
  with full trust and no consent prompt, take the permissions they need
  (`workspace:read` for tags and backlinks, and `workspace:write` as well for
  daily notes) from that same list rather than from disk, and only their on/off
  state lives in `settings.json`. The picked color scheme (theme presets
  offers three) is an app setting there too: the stored id is only looked up
  among the schemes loaded plugins registered, anything malformed reads as the
  default palette, and the stored label renders as text. A preset picked before
  the choice moved to Appearance sits in `plugins.json`: the app reads it once,
  accepts only the three preset ids by strict equality, and removes it after
  `settings.json` holds the carried-over choice. The backend
  reserves the `glyph.core.` id prefix, so an installed plugin cannot take a
  core plugin's settings, grants, or host slot.
