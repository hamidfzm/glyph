import type { Disposer } from "./disposer";

/** Capability a plugin requests; surfaced for user consent before enabling. */
export type PluginPermission = "workspace:read" | "workspace:write" | `network:${string}`;

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

export interface CommandRegistryApi {
  register(command: CommandContribution): Disposer;
}

export interface UiRegistryApi {
  addStatusBarItem(item: StatusBarItemContribution): Disposer;
}

/**
 * The capability object passed to {@link PluginModule.activate}. It is the only
 * door a plugin has to the host; there is no direct `invoke`. Every
 * registration returns a {@link Disposer}; the host collects them and runs
 * them on unload, so a plugin that only registers needs no `deactivate`.
 */
export interface GlyphPluginContext {
  readonly apiVersion: string;
  readonly commands: CommandRegistryApi;
  readonly ui: UiRegistryApi;
  notify(message: string): void;
}

/**
 * The shape a plugin's entry module must default-export. The manifest lives in
 * `manifest.json` next to the entry file, not in code.
 */
export interface PluginModule {
  activate(ctx: GlyphPluginContext): void | Promise<void>;
  deactivate?(): void;
}
