import { i18n } from "@/lib/i18n";
import { registerDictionarySource } from "@/lib/spellcheck/dictionarySources";
import { PLUGIN_API_VERSION } from "./apiVersion";
import { onPluginAppStateChange, pluginAppState } from "./appState";
import { createAssetsApi } from "./assetsApi";
import type { Disposer, DisposerBag } from "./disposer";
import { registerFileType } from "./fileTypes";
import type { PluginSettingsBackend } from "./host";
import { createNavigationApi } from "./navigationApi";
import { showOverlay } from "./overlays";
import type { Registry } from "./registry";
import { prepareRenderedHtml } from "./renderedHtml";
import { staticRenderers } from "./staticRenderers";
import type {
  CommandEntry,
  ExporterEntry,
  FencedRendererContribution,
  FileTreeFilter,
  GlyphPluginContext,
  InstalledPlugin,
  MarkdownPlugin,
  RehypeContribution,
  SettingsPanelContribution,
  SidebarPanelContribution,
  SidebarPanelEntry,
  SiteThemeContribution,
  StatusBarItemContribution,
  StyleContribution,
  WorkspaceSettingsPanelEntry,
} from "./types";
import { createVaultApi } from "./vaultApi";
import { createWorkspaceApi } from "./workspaceApi";
import { resolveWorkspacePath } from "./workspacePath";

/** The contribution registries a plugin context writes into. */
export interface ContextRegistries {
  commands: Registry<CommandEntry>;
  statusBarItems: Registry<StatusBarItemContribution>;
  remarkPlugins: Registry<MarkdownPlugin>;
  rehypePlugins: Registry<RehypeContribution>;
  fencedRenderers: Registry<FencedRendererContribution>;
  sidebarPanels: Registry<SidebarPanelEntry>;
  fileTreeFilters: Registry<FileTreeFilter>;
  settingsPanels: Registry<SettingsPanelContribution>;
  workspaceSettingsPanels: Registry<WorkspaceSettingsPanelEntry>;
  styles: Registry<StyleContribution>;
  exporters: Registry<ExporterEntry>;
  siteThemes: Registry<SiteThemeContribution>;
}

interface BuildContextOptions {
  registries: ContextRegistries;
  /** The plugin's own disposer bag; every registration is routed through it. */
  bag: DisposerBag;
  plugin: InstalledPlugin;
  settings: Record<string, unknown>;
  notify: (message: string) => void;
  registerTranslations: GlyphPluginContext["registerTranslations"];
  getWorkspaceRoot: () => string | null;
  settingsBackend: PluginSettingsBackend;
}

/** Route a registration through the plugin's own DisposerBag so unload removes
 *  exactly its contributions. Disposing early also leaves the bag: a plugin
 *  that subscribes on every mount would otherwise pin each closure until unload. */
export const tracked =
  <T>(register: (entry: T) => Disposer, bag: DisposerBag) =>
  (entry: T): Disposer => {
    const dispose = register(entry);
    bag.add(dispose);
    return () => {
      dispose();
      bag.delete(dispose);
    };
  };

/**
 * The Files panel renders a filter as given and opens the file a user clicks,
 * so a malformed one is refused here, and its paths are confined to the
 * workspace the way `navigation.openFile` confines its own.
 */
function checkedFileTreeFilter(filter: FileTreeFilter, root: string | null): FileTreeFilter {
  const { label, paths, onClear } = filter ?? {};
  const hasPaths = Array.isArray(paths) && paths.every((path) => typeof path === "string");
  if (typeof label !== "string" || !hasPaths || typeof onClear !== "function") {
    throw new Error("a file tree filter needs a label, a list of paths, and an onClear function");
  }
  if (!root) throw new Error("no workspace is open");
  const confined = paths.map((path) => {
    const resolved = resolveWorkspacePath(root, path);
    if (!resolved) throw new Error(`path is outside the workspace: ${path}`);
    return resolved;
  });
  return { label, paths: confined, onClear };
}

function isHeight(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** A frame the divider cannot work with (`NaN`, a negative height) is refused. */
function checkedSidebarPanel(panel: SidebarPanelContribution): SidebarPanelContribution {
  const frame = panel.frame;
  if (frame === undefined) return panel;
  const hasNaturalMax = frame.naturalMax === undefined || isHeight(frame.naturalMax);
  if (!isHeight(frame.min) || !hasNaturalMax) {
    throw new Error("a sidebar panel frame needs finite, non-negative heights");
  }
  return panel;
}

function subscribeToLanguage(listener: () => void): Disposer {
  const handleLanguageChanged = () => listener();
  i18n.on("languageChanged", handleLanguageChanged);
  return () => i18n.off("languageChanged", handleLanguageChanged);
}

/** The `ctx` object handed to a plugin's `activate()`. */
export function buildPluginContext({
  registries,
  bag,
  plugin,
  settings,
  notify,
  registerTranslations,
  getWorkspaceRoot,
  settingsBackend,
}: BuildContextOptions): GlyphPluginContext {
  const {
    commands,
    statusBarItems,
    remarkPlugins,
    rehypePlugins,
    fencedRenderers,
    sidebarPanels,
    fileTreeFilters,
    settingsPanels,
    workspaceSettingsPanels,
    styles,
    exporters,
    siteThemes,
  } = registries;
  const permissions = plugin.permissions ?? [];
  const workspace = createWorkspaceApi(getWorkspaceRoot, permissions, plugin.id);
  const vault = createVaultApi(getWorkspaceRoot, permissions);
  return {
    apiVersion: PLUGIN_API_VERSION,
    commands: {
      register(command) {
        return tracked(commands.register, bag)({ ...command, pluginId: plugin.id });
      },
    },
    ui: {
      addStatusBarItem: tracked(statusBarItems.register, bag),
      addSidebarPanel(panel) {
        const entry = { ...checkedSidebarPanel(panel), pluginId: plugin.id };
        return tracked(sidebarPanels.register, bag)(entry);
      },
      filterFileTree(filter) {
        const checked = checkedFileTreeFilter(filter, getWorkspaceRoot());
        return tracked(fileTreeFilters.register, bag)(checked);
      },
      addSettingsPanel(panel) {
        return tracked(settingsPanels.register, bag)({ ...panel, pluginId: plugin.id });
      },
      addWorkspaceSettingsPanel(panel) {
        const entry = { ...panel, pluginId: plugin.id };
        return tracked(workspaceSettingsPanels.register, bag)(entry);
      },
      addStyles(css) {
        return tracked(styles.register, bag)({ css });
      },
      openOverlay(overlay) {
        // Closed from Escape as often as from the disposer, so it leaves the
        // bag either way rather than piling up across slide shows.
        const close = () => {
          removeOverlay();
          bag.delete(close);
        };
        const removeOverlay = showOverlay({ ...overlay, close });
        bag.add(close);
        return close;
      },
    },
    markdown: {
      registerRemarkPlugin: tracked(remarkPlugins.register, bag),
      registerRehypePlugin: tracked(rehypePlugins.register, bag),
      registerFencedRenderer(language, render, options) {
        const disposeRenderer = tracked(fencedRenderers.register, bag)({ language, render });
        const renderStatic = options?.renderStatic;
        if (!renderStatic) return disposeRenderer;
        const disposeStatic = tracked(staticRenderers.register, bag)({ language, renderStatic });
        return () => {
          disposeRenderer();
          disposeStatic();
        };
      },
    },
    documents: {
      registerFileType: tracked(registerFileType, bag),
      getActive() {
        const active = pluginAppState().activeDocument;
        if (!active) return null;
        return {
          ...active,
          // Read on use: most callers want the path, and a long selection is
          // not free to serialize.
          get selection() {
            return window.getSelection()?.toString() ?? "";
          },
        };
      },
      onActiveChange: tracked(
        (listener) => onPluginAppStateChange("activeDocument", listener),
        bag,
      ),
      getRenderedHtml: prepareRenderedHtml,
    },
    workspace: { ...workspace, onChange: tracked(workspace.onChange, bag) },
    vault: { ...vault, onChange: tracked(vault.onChange, bag) },
    navigation: createNavigationApi(getWorkspaceRoot),
    assets: createAssetsApi(plugin.id),
    exporters: {
      register(exporter) {
        return tracked(exporters.register, bag)({ ...exporter, pluginId: plugin.id });
      },
      registerSiteTheme: tracked(siteThemes.register, bag),
    },
    // Dictionaries live in the spellcheck module's own registry (the speller
    // and the settings UI read it directly); only the disposal is routed
    // through the plugin's bag here.
    spellcheck: { registerDictionary: tracked(registerDictionarySource, bag) },
    settings: {
      get: (key) => settings[key] as never,
      set(key, value) {
        settings[key] = value;
        settingsBackend.save(plugin.id, settings);
      },
    },
    i18n: {
      t: (key, values) => i18n.t(key, values ?? {}),
      onLanguageChange: tracked(subscribeToLanguage, bag),
    },
    notify,
    registerTranslations,
  };
}
