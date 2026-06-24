# Glyph Example Plugins

Glyph can load JavaScript plugins that add commands to the command palette and
items to the status bar. A plugin is a folder with exactly two files:

```
my-plugin/
├── manifest.json   # metadata: id, name, version, apiVersion
└── main.js         # pre-built ES module, default-exporting { activate }
```

`main.js` is a single file, but you don't have to write it as one: split your
source into as many modules as you like and bundle them into one ES module
(e.g. `esbuild src/main.ts --bundle --format=esm --outfile=main.js`). The
loader imports exactly one file, so bundling is how multi-file plugins ship,
see the marketplace [CONTRIBUTING guide](https://github.com/glyph-md/plugins/blob/main/CONTRIBUTING.md).

## Try the sample

1. Open Glyph and press `Cmd/Ctrl+K` to open the command palette.
2. Run **Install Plugin from Folder…** and pick
   [`com.glyph.hello-status/`](com.glyph.hello-status/).
3. Open any markdown document; the status bar shows **Hi from a plugin**.
4. In the palette, run **Hello Plugin: Greet**; a toast appears and the
   status bar item starts counting your greetings.

Installing copies the folder into Glyph's config directory, so the plugin
loads on every launch from then on:

| OS | Installed plugins live in |
|---|---|
| macOS | `~/Library/Application Support/com.hamidfzm.glyph/plugins/` |
| Windows | `%AppData%\com.hamidfzm.glyph\plugins\` |
| Linux | `~/.config/com.hamidfzm.glyph/plugins/` |

To uninstall, delete the plugin's folder there and restart Glyph.

## Marketplace

Glyph also reads a marketplace index maintained in the `glyph-md/plugins` repo
(`index.json`, see the seed beside this file). Each entry carries the metadata
the app needs to install and to detect new versions:

```json
{ "id": "...", "name": "...", "description": "...",
  "version": "1.2.0", "apiVersion": "^1.0.0",
  "mainUrl": "https://raw.githubusercontent.com/<owner>/<repo>/<tag>/main.js" }
```

On launch the app fetches the index. Indexed plugins that aren't installed show
up in the command palette as **Install Plugin: <name>**; an installed plugin
whose `version` is behind the index shows **Update Plugin: <name>**. To publish,
a plugin author opens a PR to `glyph-md/plugins` adding or bumping their entry;
the plugin code itself lives in the author's own repo.

## manifest.json

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Unique reverse-DNS id; doubles as the install folder name (letters, digits, `.`, `_`, `-`) |
| `name` | yes | Display name |
| `version` | yes | The plugin's own semver |
| `apiVersion` | yes | Glyph plugin API range the plugin targets, e.g. `^1.0.0` |
| `description` | no | One-line summary |
| `main` | no | Entry file name, defaults to `main.js` |

## The plugin API (v1)

`main.js` must default-export an object with an `activate(ctx)` function
(and an optional `deactivate()`). Everything registered through `ctx` is
automatically removed when the plugin unloads.

```js
export default {
  activate(ctx) {
    ctx.commands.register({ id: "x.cmd", title: "My Command", run() { … } });
    ctx.ui.addStatusBarItem({
      id: "x.item",
      mount(el, registerCleanup) {
        el.textContent = "hello";
        registerCleanup(() => {/* teardown timers/listeners here */});
      },
    });
    ctx.notify("shows a toast");
    ctx.apiVersion; // the host's plugin API version
  },
};
```

The `mount(el, registerCleanup)` boundary is framework-agnostic: write to the
element with vanilla JS or hydrate it with any library, and register whatever
cleanup that needs. The API surface will grow (markdown pipeline, sidebar
panels, exporters, settings); see the
[plugin system design issue](https://github.com/hamidfzm/glyph/issues/109).
