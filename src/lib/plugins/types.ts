import type { ComponentType } from "react";
import type { Options } from "react-markdown";
import type { DictionaryContribution } from "@/lib/spellcheck/dictionarySources";
import type { Backlink, GraphEdge, GraphNode, TagCount } from "@/lib/vault";
import type { Disposer } from "./disposer";

export type { DictionaryContribution } from "@/lib/spellcheck/dictionarySources";
export type { Backlink, GraphEdge, GraphNode, TagCount } from "@/lib/vault";
export type { Disposer } from "./disposer";

/** Capability a plugin requests; surfaced for user consent before enabling. */
export type PluginPermission = "workspace:read" | "workspace:write" | `network:${string}`;

/**
 * A remark or rehype plugin, in the shape react-markdown accepts (`plugin` or
 * `[plugin, options]`). Sourced from react-markdown's own types so the plugin
 * contract stays in lockstep with the renderer.
 */
export type MarkdownPlugin = NonNullable<Options["remarkPlugins"]>[number];

/**
 * 0.25.0: a rehype plugin that loads only once a document needs it, so a heavy
 * renderer (KaTeX for math) costs nothing until then.
 */
export interface LazyMarkdownPlugin {
  /** A cheap check of a document's markdown. True starts the load. */
  detect(markdown: string): boolean;
  /** Import the plugin. Runs once, for the first document `detect` accepts. */
  load(): Promise<MarkdownPlugin>;
}

/** What `registerRehypePlugin` accepts. */
export type RehypeContribution = MarkdownPlugin | LazyMarkdownPlugin;

/** What a fenced renderer receives. */
export interface FencedRendererProps {
  code: string;
  /**
   * Open an image zoomable over the document. Absent where the host offers no
   * zoom; exports strip the interactive attributes a render adds for it.
   */
  openLightbox?: (src: string, label: string) => void;
}

/**
 * A framework-agnostic fenced renderer: draws into `el` the way the panel
 * mounts do, with no dependency on the app's React. When the block's props
 * change, the previous cleanups run and it is mounted again over its previous
 * output, so it can keep that on screen until the new render is ready (set
 * `aria-busy` on `el` meanwhile).
 */
export interface FencedRendererMount {
  mount(
    el: HTMLElement,
    props: FencedRendererProps,
    registerCleanup: (cleanup: Disposer) => void,
  ): void;
}

export interface FencedRendererOptions {
  /**
   * Light-theme markup (typically an SVG) for print, PDF, and website export,
   * which cannot reuse a live render drawn in the app theme's colors. The host
   * sanitizes it before it reaches the document, and a website export drops
   * its image references other than `data:` URLs.
   */
  renderStatic?: (code: string) => Promise<string>;
}

/** Renders a fenced code block of `language` (e.g. ```d2). */
export interface FencedRendererContribution {
  language: string;
  render: ComponentType<FencedRendererProps> | FencedRendererMount;
}

/**
 * A document type a plugin opens. Files with these extensions open in the
 * viewer and render as one fenced `language` block, so pair it with a fenced
 * renderer for that language.
 */
export interface FileTypeContribution {
  /** Extensions without the dot, e.g. `["d2"]`. */
  extensions: readonly string[];
  language: string;
}

/**
 * Declarative metadata shipped alongside a plugin's built `main.js`. Mirrors the
 * `manifest.json` an installed plugin folder contains.
 */
export interface PluginManifest {
  /** Reverse-DNS unique id, e.g. `com.author.slides`. */
  id: string;
  name: string;
  /** The plugin's own semver. */
  version: string;
  /**
   * Plugin API version this plugin targets. While the API major is 0, any
   * version inside the host's compatibility window (floor through current)
   * loads; from 1.0 on, exact or caret semver ranges apply.
   */
  apiVersion: string;
  description?: string;
  /** Entry file relative to the plugin folder. Defaults to `main.js`. */
  main?: string;
  /** Capabilities requested; shown on the consent screen before first enable. */
  permissions?: PluginPermission[];
  /**
   * Run in a dedicated worker instead of the app context. Sandboxed plugins
   * get no DOM and network fenced to their `network:` permissions, but only
   * the non-UI API subset: commands, styles, exporters, file types, workspace,
   * assets, spellcheck, settings, notify, and registering translations. No
   * markdown pipeline, panel or overlay mounts, reading the rendered
   * document, app state (the active document, the vault, navigation), or
   * reading translations.
   *
   * Absent defaults to `true`: isolation is the default, and only an explicit
   * `false` opts into full trust, which needs a distinct user grant.
   */
  sandbox?: boolean;
  /**
   * The files the plugin consists of (must include `main`). Installs copy
   * exactly these out of a package or folder, and `ctx.assets` reads are
   * limited to them. Omitted for a single-file plugin.
   */
  files?: string[];
}

/**
 * An installed plugin as returned by the Rust `list_plugins` / `install_plugin`
 * commands: validated manifest fields plus the entry file's source text, ready
 * for the loader.
 */
export interface InstalledPlugin {
  id: string;
  name: string;
  version: string;
  apiVersion: string;
  description?: string;
  /** Capabilities the plugin declares; shown to the user before install. */
  permissions?: string[];
  /**
   * Run isolated in a worker; see {@link PluginManifest.sandbox}. Always set:
   * Rust resolves the manifest default (absent = true) before serializing.
   */
  sandbox: boolean;
  /** Manifest-declared files; see {@link PluginManifest.files}. */
  files?: string[];
  /** Absolute path of the installed plugin folder. */
  dir: string;
  /** Source text of the plugin's ESM entry file. */
  mainSource: string;
}

/**
 * Metadata of a picked-but-not-yet-installed plugin folder, as returned by the
 * Rust `inspect_plugin` command. Backs the pre-install consent dialog.
 */
export interface PluginInspection {
  id: string;
  name: string;
  version: string;
  description?: string;
  permissions: string[];
  sandbox: boolean;
}

/** A command contributed to the palette. */
export interface CommandContribution {
  id: string;
  title: string;
  run: () => void | Promise<void>;
  /** 0.26.0: also list it in this native menu (desktop). */
  menu?: "view";
}

/** A command as the host holds it, stamped with the plugin that added it. */
export interface CommandEntry extends CommandContribution {
  pluginId: string;
}

/**
 * Renders into a host-provided container. The mount boundary is deliberately
 * framework-agnostic: vanilla JS writes into `el` directly, and any framework
 * can hydrate it. Register teardown (event listeners, timers, framework
 * unmount) via `registerCleanup`; the host runs it on unload. Passing cleanup
 * through a callback keeps the return type plain `void`, so a mount that needs
 * no teardown is just `(el) => { ... }`.
 */
export interface MountContribution {
  id: string;
  mount: (el: HTMLElement, registerCleanup: (cleanup: Disposer) => void) => void;
}

/** A status bar item contribution. */
export type StatusBarItemContribution = MountContribution;

/** A stylesheet contributed by a plugin, injected after the app styles. */
export interface StyleContribution {
  css: string;
}

/** A titled sidebar section contribution. */
export interface SidebarPanelContribution extends MountContribution {
  /** Section heading shown above the panel in the sidebar. */
  title: string;
  /**
   * 0.26.0: `"files"` puts the panel in the Files panel, below the tree, as a
   * block the user can collapse and resize, whether or not the note has
   * headings. Absent or `"outline"` keeps it below the outline.
   */
  location?: "outline" | "files";
  /**
   * 0.26.0: height bounds of a `files` block in pixels: the smallest the
   * divider allows, and how far the block grows on its own before it scrolls.
   * Both must be finite and not negative, or the panel is refused.
   */
  frame?: { min: number; naturalMax?: number };
  /**
   * 0.26.0: fills the heading of a `files` block after its title (a count, a
   * button). While the block is collapsed, the block element around both
   * mounts carries `data-collapsed`, for a stylesheet to key on.
   */
  mountHeading?: MountContribution["mount"];
}

/** A sidebar panel as the host holds it, stamped with the plugin that added it. */
export interface SidebarPanelEntry extends SidebarPanelContribution {
  pluginId: string;
}

/** 0.26.0: a list of workspace files shown in place of the file tree. */
export interface FileTreeFilter {
  /** Heading above the list, e.g. `#project (3)`. */
  label: string;
  /**
   * Workspace files in the order to list them, absolute or relative to the
   * workspace root. A path outside the workspace is refused.
   */
  paths: readonly string[];
  /** The user dismissed the list; dispose the filter. */
  onClear: () => void;
}

/**
 * A settings UI contribution, shown under the plugin's row in the Settings Plugins tab.
 * The host keys it by plugin id, so each plugin has at most one panel.
 */
export interface SettingsPanelContribution extends MountContribution {
  /** Set by the host to the owning plugin's id. */
  pluginId: string;
}

/** 0.26.0: what an exporter needs to make its output look like the app. */
export interface ExportDocument {
  /** Plain text; escape it before putting it in markup. */
  title: string;
  /** Every style rule the app applies, so the body HTML renders as it does in the app. */
  css: string;
  dark: boolean;
}

/**
 * An export format contribution. The host runs the shared pipeline (prepare
 * the rendered document, ask for a save location, write the file); the plugin
 * only turns HTML into bytes.
 */
export interface ExporterContribution {
  id: string;
  /** Palette and File > Export label, e.g. "reveal.js slides". */
  label: string;
  /** File extension without the dot, e.g. "html". */
  extension: string;
  /** Convert the prepared document HTML into file contents. */
  build: (bodyHtml: string, doc: ExportDocument) => Promise<Uint8Array | string>;
}

/** An exporter as the host holds it, stamped with the plugin that added it. */
export interface ExporterEntry extends ExporterContribution {
  pluginId: string;
}

/** 0.26.0: content shown over the whole app, with the window taken fullscreen. */
export interface OverlayContribution extends MountContribution {
  /** Accessible name of the overlay. */
  label: string;
}

export interface CommandRegistryApi {
  register(command: CommandContribution): Disposer;
}

export interface UiRegistryApi {
  /**
   * Not available to sandboxed plugins: mounting needs a live DOM element and
   * the sandbox is a worker. Calling it there throws, naming the method. A
   * plugin that contributes UI must declare `"sandbox": false`, and the same
   * applies to {@link addSidebarPanel} and {@link addSettingsPanel}.
   */
  addStatusBarItem(item: StatusBarItemContribution): Disposer;
  /** Not available to sandboxed plugins; see {@link addStatusBarItem}. */
  addSidebarPanel(panel: SidebarPanelContribution): Disposer;
  /** One settings panel per plugin; the host keys it by the plugin's id. Not
   *  available to sandboxed plugins; see {@link addStatusBarItem}. */
  addSettingsPanel(panel: MountContribution): Disposer;
  /**
   * 0.26.0: open an overlay over the whole app, replacing any open one. Escape
   * closes it and runs its cleanups, as does the returned disposer. Not
   * available to sandboxed plugins; see {@link addStatusBarItem}.
   */
  openOverlay(overlay: OverlayContribution): Disposer;
  /**
   * 0.26.0: list `paths` in place of the file tree until the returned disposer
   * runs. One filter shows at a time, the newest. Throws for a malformed
   * filter, a path outside the workspace, or when no workspace is open. Not
   * available to sandboxed plugins.
   */
  filterFileTree(filter: FileTreeFilter): Disposer;
  /**
   * Inject a stylesheet after the app styles (theme plugins, custom CSS).
   * Removed automatically when the plugin unloads.
   */
  addStyles(css: string): Disposer;
}

/**
 * A theme for the exported website. Its CSS is appended to the site's shared
 * style.css after the built-in chrome, so it can restyle anything: the
 * `.glyph-site-header`, `.glyph-site-nav`, `.glyph-site-outline`, and
 * `.markdown-body` content column. Selected per workspace via the `theme`
 * field of `.glyph/site.json`.
 */
export interface SiteThemeContribution {
  /** Id referenced from `.glyph/site.json`, e.g. `"solarized"`. */
  id: string;
  /** Human-readable name shown in docs and error messages. */
  label: string;
  css: string;
}

export interface ExportersRegistryApi {
  register(exporter: ExporterContribution): Disposer;
  /** Contribute a theme for the website export. */
  registerSiteTheme(theme: SiteThemeContribution): Disposer;
}

/**
 * Per-plugin persisted key-value settings. Hydrated before `activate`, so
 * `get` is synchronous; `set` persists in the background.
 */
export interface PluginSettingsApi {
  get<T = unknown>(key: string): T | undefined;
  set(key: string, value: unknown): void;
}

export interface SpellcheckRegistryApi {
  /**
   * Contribute a spell-check dictionary for a language. It appears in the
   * Settings language picker under `label`, and `load` runs only when the user
   * selects the language. Registering an already-known code (including the
   * built-in "en") replaces it; the disposer removes the dictionary and drops
   * any cached checker built from it.
   */
  registerDictionary(dictionary: DictionaryContribution): Disposer;
}

export interface MarkdownRegistryApi {
  /** Add a remark plugin (runs after the built-in remark plugins). */
  registerRemarkPlugin(plugin: MarkdownPlugin): Disposer;
  /**
   * Add a rehype plugin (runs after the built-in rehype plugins, incl. sanitize).
   * 0.25.0: a {@link LazyMarkdownPlugin} loads only for documents that need it.
   *
   * Math: wrap rendered math in an element carrying its TeX source in
   * `data-math-source`, plus `data-math-display` for block math. PDF export
   * captures block math, and any text block holding math, as an image; Word,
   * and PDF when a capture fails, fall back to the source.
   */
  registerRehypePlugin(plugin: RehypeContribution): Disposer;
  /**
   * Render fenced ```<language> blocks, with a {@link FencedRendererMount} or
   * a React component. While a render is still pending, mark its element
   * `aria-busy="true"` so exports wait.
   */
  registerFencedRenderer(
    language: string,
    render: ComponentType<FencedRendererProps> | FencedRendererMount,
    options?: FencedRendererOptions,
  ): Disposer;
}

/** Read the translations a plugin registered. Not available to sandboxed plugins. */
export interface I18nApi {
  /** Translate `namespace:key` in the app's current language, with i18next `{{name}}` values. */
  t(key: string, values?: Record<string, unknown>): string;
  /** Run `listener` after the app switches language, to refresh strings already on screen. */
  onLanguageChange(listener: () => void): Disposer;
}

/** 0.26.0: the document in the active tab. */
export interface ActiveDocument {
  /** Absolute path, or the placeholder name of a document not saved yet. */
  path: string;
  /** Its text, unsaved edits included; null while it loads or when it has none (an image). */
  text: string | null;
  /** The text the user has selected in the window, empty when none. */
  selection: string;
}

export interface DocumentsRegistryApi {
  /** Open files with these extensions as one fenced block; see {@link FileTypeContribution}. */
  registerFileType(fileType: FileTypeContribution): Disposer;
  /**
   * 0.26.0: the active document, or null when no document tab is active. Needs
   * no permission: a plugin in the app context can read the window anyway. Not
   * available to sandboxed plugins.
   */
  getActive(): ActiveDocument | null;
  /**
   * 0.26.0: run `listener` when another document becomes active, or none.
   * Typing in the active one does not count. Not available to sandboxed plugins.
   */
  onActiveChange(listener: () => void): Disposer;
  /**
   * 0.26.0: the active document's rendered HTML as exporters receive it, or
   * null when nothing is rendered. Not available to sandboxed plugins: they
   * see document content only through an export the user runs.
   */
  getRenderedHtml(): Promise<string | null>;
}

/**
 * 0.26.0: read-only queries over the workspace index. Requires the
 * `workspace:read` permission; paths are absolute. Not available to sandboxed
 * plugins.
 */
export interface VaultApi {
  /** Every indexed note and the resolved links between them. */
  graph(): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }>;
  /** Inbound links to the note at `path`. */
  backlinks(path: string): Promise<Backlink[]>;
  /** Every tag with the number of files carrying it or a tag nested under it. */
  tags(): Promise<TagCount[]>;
  /** Files carrying `tag` or a tag nested under it. */
  pathsWithTag(tag: string): Promise<string[]>;
  /**
   * Whether indexing stopped short of the whole workspace (it is too large).
   * Every other answer then covers only the part that was indexed.
   */
  status(): Promise<{ truncated: boolean }>;
  /** Run `listener` after the index changes: an edit, a rename, another workspace. */
  onChange(listener: () => void): Disposer;
}

/** 0.26.0: move the app to a document. Not available to sandboxed plugins. */
export interface NavigationApi {
  /**
   * Open a workspace file in a tab, or switch to its tab. `path` is absolute
   * or relative to the workspace root, and a path outside it throws. `line`
   * (1-based) scrolls the rendered document to that source line; it has no
   * effect when the note opens in another window or shows no rendered view.
   * Needs no permission.
   */
  openFile(path: string, options?: { line?: number }): void;
}

/**
 * The capability object passed to {@link PluginModule.activate}. It is the only
 * door a plugin has to the host; there is no direct `invoke`. Every
 * registration returns a {@link Disposer}; the host collects them and runs
 * them on unload, so a plugin that only registers needs no `deactivate`.
 */
/**
 * Mediated, read-only access to the opened workspace. Requires the plugin to
 * declare the `workspace:read` permission; paths are workspace-relative and
 * confined to the workspace root.
 */
export interface WorkspaceApi {
  /** Read a file inside the workspace (workspace-relative path). */
  readFile(path: string): Promise<string>;
  /** List the workspace's markdown files (absolute paths). */
  listFiles(): Promise<string[]>;
  /**
   * 0.26.0: absolute path of the opened workspace, or null when none is open.
   * Not available to sandboxed plugins.
   */
  getRoot(): string | null;
  /**
   * 0.26.0: run `listener` when the workspace opens, closes, or changes. Not
   * available to sandboxed plugins.
   */
  onChange(listener: () => void): Disposer;
}

/**
 * Read the plugin's own bundled files (the manifest-declared `files`). No
 * permission needed: it is the plugin's own reviewed content. Paths are as
 * declared in the manifest, e.g. `assets/fa.dic`.
 */
export interface AssetsApi {
  readText(path: string): Promise<string>;
  readBinary(path: string): Promise<Uint8Array>;
}

export interface GlyphPluginContext {
  readonly apiVersion: string;
  readonly commands: CommandRegistryApi;
  readonly ui: UiRegistryApi;
  readonly markdown: MarkdownRegistryApi;
  readonly documents: DocumentsRegistryApi;
  readonly workspace: WorkspaceApi;
  readonly vault: VaultApi;
  readonly navigation: NavigationApi;
  readonly assets: AssetsApi;
  readonly exporters: ExportersRegistryApi;
  readonly spellcheck: SpellcheckRegistryApi;
  readonly settings: PluginSettingsApi;
  readonly i18n: I18nApi;
  notify(message: string): void;
  /**
   * Register (or extend) translations for a locale + namespace. A plugin ships
   * its own strings and reads them through the host's i18n; the bundle is
   * deep-merged, so it augments rather than replaces existing keys.
   */
  registerTranslations(locale: string, namespace: string, resources: Record<string, unknown>): void;
}

/**
 * The shape a plugin's entry module must default-export. The manifest lives in
 * `manifest.json` next to the entry file, not in code.
 */
export interface PluginModule {
  activate(ctx: GlyphPluginContext): void | Promise<void>;
  deactivate?(): void;
}
