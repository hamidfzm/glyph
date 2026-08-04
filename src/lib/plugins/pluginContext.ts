import { registerDictionarySource } from "@/lib/spellcheck/dictionarySources";
import { PLUGIN_API_VERSION } from "./apiVersion";
import { createAssetsApi } from "./assetsApi";
import type { Disposer, DisposerBag } from "./disposer";
import type { PluginSettingsBackend } from "./host";
import type { Registry } from "./registry";
import type {
  CommandContribution,
  ExporterContribution,
  FencedRendererContribution,
  GlyphPluginContext,
  InstalledPlugin,
  MarkdownPlugin,
  SettingsPanelContribution,
  SidebarPanelContribution,
  SiteThemeContribution,
  StatusBarItemContribution,
  StyleContribution,
} from "./types";
import { createWorkspaceApi } from "./workspaceApi";

/** The contribution registries a plugin context writes into. */
export interface ContextRegistries {
  commands: Registry<CommandContribution>;
  statusBarItems: Registry<StatusBarItemContribution>;
  remarkPlugins: Registry<MarkdownPlugin>;
  rehypePlugins: Registry<MarkdownPlugin>;
  fencedRenderers: Registry<FencedRendererContribution>;
  sidebarPanels: Registry<SidebarPanelContribution>;
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
 *  exactly its contributions. */
export const tracked =
  <T>(register: (entry: T) => Disposer, bag: DisposerBag) =>
  (entry: T): Disposer => {
    const dispose = register(entry);
    bag.add(dispose);
    return dispose;
  };

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
    settingsPanels,
    styles,
    exporters,
    siteThemes,
  } = registries;
  return {
    apiVersion: PLUGIN_API_VERSION,
    commands: { register: tracked(commands.register, bag) },
    ui: {
      addStatusBarItem: tracked(statusBarItems.register, bag),
      addSidebarPanel: tracked(sidebarPanels.register, bag),
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
      registerFencedRenderer(language, render) {
        return tracked(fencedRenderers.register, bag)({ language, render });
      },
    },
    workspace: createWorkspaceApi(getWorkspaceRoot, plugin.permissions ?? []),
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
    notify,
    registerTranslations,
  };
}
