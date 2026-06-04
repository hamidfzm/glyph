import type * as React from "react";
import type { Options } from "react-markdown";
import type { Disposer } from "./disposer";

/**
 * A remark or rehype plugin entry, in the same shape react-markdown accepts
 * (`plugin` or `[plugin, options]`). Sourced from react-markdown's own types so
 * the plugin contract stays in lockstep with the renderer.
 */
export type MarkdownPlugin = NonNullable<Options["remarkPlugins"]>[number];

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
  /** Minimum compatible Glyph app version. */
  minAppVersion?: string;
  description?: string;
  author?: string;
  /** Entry file relative to the plugin folder. Defaults to `main.js`. */
  main?: string;
  /** Capabilities requested; shown on the consent screen before first enable. */
  permissions?: PluginPermission[];
}

/** A command contributed to the palette (and optionally a shortcut). */
export interface CommandContribution {
  id: string;
  title: string;
  run: () => void | Promise<void>;
  keybinding?: string;
}

/**
 * Renders into a host-provided container. The mount boundary is deliberately
 * framework-agnostic: React authors get a thin helper on top, but Svelte/Vue/
 * vanilla plugins can mount into `el` directly. Register any teardown (event
 * listeners, timers, framework unmount) via `registerCleanup`; the host runs it
 * on unload. Passing cleanup through a callback keeps the return type plain
 * `void`, so a mount that needs no teardown is just `(el) => { ... }`.
 */
export interface MountContribution {
  id: string;
  mount: (el: HTMLElement, registerCleanup: (cleanup: Disposer) => void) => void;
}

/** A sidebar panel contribution. */
export interface SidebarPanelContribution extends MountContribution {
  title: string;
  icon?: React.ComponentType;
}

/** A status bar item contribution. */
export type StatusBarItemContribution = MountContribution;

/** An export format contribution, run against the active document. */
export interface ExporterContribution {
  format: string;
  label: string;
  run: () => Promise<void>;
}

/** Lifecycle/workspace events a plugin can observe. */
export type PluginEvent = "file-opened" | "file-saved" | "active-tab-changed";

export interface MarkdownRegistry {
  registerRemarkPlugin(plugin: MarkdownPlugin): Disposer;
  registerRehypePlugin(plugin: MarkdownPlugin): Disposer;
  registerComponent(tag: string, component: React.ComponentType<Record<string, unknown>>): Disposer;
  registerFencedRenderer(lang: string, component: React.ComponentType<{ code: string }>): Disposer;
}

export interface CommandRegistry {
  register(command: CommandContribution): Disposer;
}

export interface UiRegistry {
  addSidebarPanel(panel: SidebarPanelContribution): Disposer;
  addStatusBarItem(item: StatusBarItemContribution): Disposer;
}

export interface ExporterRegistry {
  register(exporter: ExporterContribution): Disposer;
}

/** Per-plugin scoped settings, persisted under `settings.plugins.<id>`. */
export interface PluginSettingsApi {
  get<T = unknown>(key: string): T | undefined;
  set(key: string, value: unknown): void;
}

export interface EventBus {
  on(event: PluginEvent, handler: (payload: unknown) => void): Disposer;
}

/**
 * The capability object passed to {@link GlyphPlugin.activate}. It is the only
 * door a plugin has to the host — there is no direct `invoke`. Every `register*`
 * call returns a {@link Disposer}; the loader collects them and runs them on
 * unload.
 */
export interface GlyphPluginContext {
  readonly apiVersion: string;
  readonly markdown: MarkdownRegistry;
  readonly commands: CommandRegistry;
  readonly ui: UiRegistry;
  readonly exporters: ExporterRegistry;
  readonly settings: PluginSettingsApi;
  readonly events: EventBus;
  notify(message: string, level?: "info" | "warn" | "error"): void;
  /** The host's single React instance — plugins must not bundle their own. */
  readonly React: typeof React;
}

/**
 * The object a plugin's `main.js` default-exports. `activate` wires the plugin
 * into the host through {@link GlyphPluginContext}; `deactivate` runs on
 * disable/unload (in addition to the auto-collected disposers).
 */
export interface GlyphPlugin {
  manifest: PluginManifest;
  activate(ctx: GlyphPluginContext): void | Promise<void>;
  deactivate?(): void;
}
