import type { ComponentType } from "react";
import type { Options } from "react-markdown";
import type { DictionaryContribution } from "@/lib/spellcheck/dictionarySources";
import type { Disposer } from "./disposer";

export type { DictionaryContribution } from "@/lib/spellcheck/dictionarySources";

/** Capability a plugin requests; surfaced for user consent before enabling. */
export type PluginPermission = "workspace:read" | "workspace:write" | `network:${string}`;

/**
 * A remark or rehype plugin, in the shape react-markdown accepts (`plugin` or
 * `[plugin, options]`). Sourced from react-markdown's own types so the plugin
 * contract stays in lockstep with the renderer.
 */
export type MarkdownPlugin = NonNullable<Options["remarkPlugins"]>[number];

/** Renders a fenced code block of `language` (e.g. ```d2) as a React component. */
export interface FencedRendererContribution {
  language: string;
  render: ComponentType<{ code: string }>;
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
   * the non-UI API subset: commands, styles, exporters, workspace, settings,
   * notify, and translations. No markdown pipeline or panel mounts.
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
}

/**
 * A settings UI contribution, shown under the plugin's row in Manage Plugins.
 * The host keys it by plugin id, so each plugin has at most one panel.
 */
export interface SettingsPanelContribution extends MountContribution {
  /** Set by the host to the owning plugin's id. */
  pluginId: string;
}

/**
 * An export format contribution. The host runs the shared pipeline (prepare
 * the rendered document, ask for a save location, write the file); the plugin
 * only turns HTML into bytes.
 */
export interface ExporterContribution {
  id: string;
  /** Palette label, e.g. "reveal.js slides". */
  label: string;
  /** File extension without the dot, e.g. "html". */
  extension: string;
  /** Convert the prepared document HTML into file contents. */
  build: (bodyHtml: string) => Promise<Uint8Array | string>;
}

export interface CommandRegistryApi {
  register(command: CommandContribution): Disposer;
}

export interface UiRegistryApi {
  addStatusBarItem(item: StatusBarItemContribution): Disposer;
  addSidebarPanel(panel: SidebarPanelContribution): Disposer;
  /** One settings panel per plugin; the host keys it by the plugin's id. */
  addSettingsPanel(panel: MountContribution): Disposer;
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
  /** Add a rehype plugin (runs after the built-in rehype plugins, incl. sanitize). */
  registerRehypePlugin(plugin: MarkdownPlugin): Disposer;
  /** Render fenced ```<language> blocks with a React component. */
  registerFencedRenderer(language: string, render: ComponentType<{ code: string }>): Disposer;
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
  readonly workspace: WorkspaceApi;
  readonly assets: AssetsApi;
  readonly exporters: ExportersRegistryApi;
  readonly spellcheck: SpellcheckRegistryApi;
  readonly settings: PluginSettingsApi;
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
