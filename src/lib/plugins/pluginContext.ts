import { i18n } from "@/lib/i18n";
import { registerDictionarySource } from "@/lib/spellcheck/dictionarySources";
import { PLUGIN_API_VERSION } from "./apiVersion";
import { onPluginAppStateChange, pluginAppState } from "./appState";
import { createAssetsApi } from "./assetsApi";
import type { Disposer, DisposerBag } from "./disposer";
import { registerFileType } from "./fileTypes";
import type { PluginSettingsBackend } from "./host";
import { createNavigationApi } from "./navigationApi";
import type { Registry } from "./registry";
import { staticRenderers } from "./staticRenderers";
import type {
  CommandContribution,
  ExporterContribution,
  FencedRendererContribution,
  FileTreeFilter,
  GlyphPluginContext,
  InstalledPlugin,
  MarkdownPlugin,
  RehypeContribution,
  SettingsPanelContribution,
  SidebarPanelEntry,
  SiteThemeContribution,
  StatusBarItemContribution,
  StyleContribution,
} from "./types";
import { createVaultApi } from "./vaultApi";
import { createWorkspaceApi } from "./workspaceApi";

/** The contribution registries a plugin context writes into. */
export interface ContextRegistries {
  commands: Registry<CommandContribution>;
  statusBarItems: Registry<StatusBarItemContribution>;
  remarkPlugins: Registry<MarkdownPlugin>;
  rehypePlugins: Registry<RehypeContribution>;
  fencedRenderers: Registry<FencedRendererContribution>;
  sidebarPanels: Registry<SidebarPanelEntry>;
  fileTreeFilters: Registry<FileTreeFilter>;
  settingsPanels: Registry<SettingsPanelContribution>;
  styles: Registry<StyleContribution>;
  exporters: Registry<ExporterContribution>;
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
    styles,
    exporters,
    siteThemes,
  } = registries;
  const permissions = plugin.permissions ?? [];
  const workspace = createWorkspaceApi(getWorkspaceRoot, permissions);
  const vault = createVaultApi(getWorkspaceRoot, permissions);
  return {
    apiVersion: PLUGIN_API_VERSION,
    commands: { register: tracked(commands.register, bag) },
    ui: {
      addStatusBarItem: tracked(statusBarItems.register, bag),
      addSidebarPanel(panel) {
        return tracked(sidebarPanels.register, bag)({ ...panel, pluginId: plugin.id });
      },
      filterFileTree: tracked(fileTreeFilters.register, bag),
      addSettingsPanel(panel) {
        return tracked(settingsPanels.register, bag)({ ...panel, pluginId: plugin.id });
      },
      addStyles(css) {
        return tracked(styles.register, bag)({ css });
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
        return { ...active, selection: window.getSelection()?.toString() ?? "" };
      },
      onActiveChange: tracked(
        (listener) => onPluginAppStateChange("activeDocument", listener),
        bag,
      ),
    },
    workspace: { ...workspace, onChange: tracked(workspace.onChange, bag) },
    vault: { ...vault, onChange: tracked(vault.onChange, bag) },
    navigation: createNavigationApi(getWorkspaceRoot),
    assets: createAssetsApi(plugin.id),
    exporters: {
      register: tracked(exporters.register, bag),
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
