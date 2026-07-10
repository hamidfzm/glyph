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
  /** Semver range against {@link PLUGIN_API_VERSION}, e.g. `^1.0.0`. */
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
   */
  sandbox?: boolean;
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
  /** Run isolated in a worker; see {@link PluginManifest.sandbox}. */
  sandbox?: boolean;
  /** Absolute path of the installed plugin folder. */
  dir: string;
  /** Source text of the plugin's ESM entry file. */
  mainSource: string;
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

export interface ExportersRegistryApi {
  register(exporter: ExporterContribution): Disposer;
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

export interface GlyphPluginContext {
  readonly apiVersion: string;
  readonly commands: CommandRegistryApi;
  readonly ui: UiRegistryApi;
  readonly markdown: MarkdownRegistryApi;
  readonly workspace: WorkspaceApi;
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
