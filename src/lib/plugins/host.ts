import { PLUGIN_API_VERSION, satisfiesApiVersion } from "./apiVersion";
import { DisposerBag } from "./disposer";
import { importPluginModule, type ModuleImporter } from "./loader";
import { createRegistry, type Registry } from "./registry";
import type {
  CommandContribution,
  GlyphPluginContext,
  InstalledPlugin,
  PluginModule,
  StatusBarItemContribution,
} from "./types";

export interface LoadedPluginInfo {
  id: string;
  name: string;
  version: string;
  description?: string;
}

export interface PluginHost {
  /** Commands contributed by loaded plugins (palette section "Commands"). */
  readonly commands: Registry<CommandContribution>;
  /** Status bar items contributed by loaded plugins. */
  readonly statusBarItems: Registry<StatusBarItemContribution>;
  /**
   * Import and activate an installed plugin. Re-loading an already-loaded id
   * unloads the previous instance first. Throws on apiVersion mismatch, a bad
   * entry module, or an `activate` that throws.
   */
  load(plugin: InstalledPlugin, importer?: ModuleImporter): Promise<void>;
  /** Tear down one plugin: run its disposers, then its `deactivate`. */
  unload(id: string): void;
  /** Tear down every loaded plugin (app shutdown / provider unmount). */
  unloadAll(): void;
  listLoaded(): LoadedPluginInfo[];
}

interface LoadedPlugin {
  info: LoadedPluginInfo;
  module: PluginModule;
  bag: DisposerBag;
}

/**
 * Owns the contribution registries and the plugin lifecycle. Each loaded
 * plugin gets a context whose `register*` calls are routed through its own
 * {@link DisposerBag}, so unloading a plugin removes exactly its
 * contributions and nothing else.
 */
export function createPluginHost(notify: (message: string) => void): PluginHost {
  const commands = createRegistry<CommandContribution>();
  const statusBarItems = createRegistry<StatusBarItemContribution>();
  const loaded = new Map<string, LoadedPlugin>();

  const buildContext = (bag: DisposerBag): GlyphPluginContext => ({
    apiVersion: PLUGIN_API_VERSION,
    commands: {
      register(command) {
        const dispose = commands.register(command);
        bag.add(dispose);
        return dispose;
      },
    },
    ui: {
      addStatusBarItem(item) {
        const dispose = statusBarItems.register(item);
        bag.add(dispose);
        return dispose;
      },
    },
    notify,
  });

  const unload = (id: string) => {
    const plugin = loaded.get(id);
    if (!plugin) return;
    loaded.delete(id);
    plugin.bag.dispose();
    try {
      plugin.module.deactivate?.();
    } catch (err) {
      console.error(`Plugin ${id} threw in deactivate():`, err);
    }
  };

  return {
    commands,
    statusBarItems,
    async load(plugin, importer) {
      if (!satisfiesApiVersion(plugin.apiVersion)) {
        throw new Error(
          `${plugin.name} requires plugin API ${plugin.apiVersion}, but this Glyph provides ${PLUGIN_API_VERSION}`,
        );
      }
      unload(plugin.id);
      const module = await importPluginModule(plugin.mainSource, importer);
      const bag = new DisposerBag();
      try {
        await module.activate(buildContext(bag));
      } catch (err) {
        bag.dispose(); // roll back anything registered before the throw
        throw err;
      }
      loaded.set(plugin.id, {
        info: {
          id: plugin.id,
          name: plugin.name,
          version: plugin.version,
          description: plugin.description,
        },
        module,
        bag,
      });
    },
    unload,
    unloadAll() {
      for (const id of [...loaded.keys()]) unload(id);
    },
    listLoaded() {
      return [...loaded.values()].map((p) => p.info);
    },
  };
}
