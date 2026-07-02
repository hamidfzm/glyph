import { PLUGIN_API_VERSION, satisfiesApiVersion } from "./apiVersion";
import { type Disposer, DisposerBag } from "./disposer";
import { importPluginModule, type ModuleImporter } from "./loader";
import { createRegistry, type Registry } from "./registry";
import type {
  CommandContribution,
  FencedRendererContribution,
  GlyphPluginContext,
  InstalledPlugin,
  MarkdownPlugin,
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
  /** Remark plugins contributed by loaded plugins. */
  readonly remarkPlugins: Registry<MarkdownPlugin>;
  /** Rehype plugins contributed by loaded plugins. */
  readonly rehypePlugins: Registry<MarkdownPlugin>;
  /** Fenced code-block renderers contributed by loaded plugins. */
  readonly fencedRenderers: Registry<FencedRendererContribution>;
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
export function createPluginHost(
  notify: (message: string) => void,
  // i18n registration is injected so the host stays decoupled (and testable
  // without i18next). Defaults to a no-op. Translations persist past unload,
  // which is harmless (just unused strings in memory).
  registerTranslations: GlyphPluginContext["registerTranslations"] = () => {},
): PluginHost {
  const commands = createRegistry<CommandContribution>();
  const statusBarItems = createRegistry<StatusBarItemContribution>();
  const remarkPlugins = createRegistry<MarkdownPlugin>();
  const rehypePlugins = createRegistry<MarkdownPlugin>();
  const fencedRenderers = createRegistry<FencedRendererContribution>();
  const loaded = new Map<string, LoadedPlugin>();

  // Route a registration through the plugin's own DisposerBag so unload removes
  // exactly its contributions.
  const tracked =
    <T>(register: (entry: T) => Disposer, bag: DisposerBag) =>
    (entry: T): Disposer => {
      const dispose = register(entry);
      bag.add(dispose);
      return dispose;
    };

  const buildContext = (bag: DisposerBag): GlyphPluginContext => ({
    apiVersion: PLUGIN_API_VERSION,
    commands: { register: tracked(commands.register, bag) },
    ui: { addStatusBarItem: tracked(statusBarItems.register, bag) },
    markdown: {
      registerRemarkPlugin: tracked(remarkPlugins.register, bag),
      registerRehypePlugin: tracked(rehypePlugins.register, bag),
      registerFencedRenderer(language, render) {
        return tracked(fencedRenderers.register, bag)({ language, render });
      },
    },
    notify,
    registerTranslations,
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

  // Guards against overlapping load() calls for the same id (rapid re-enable
  // or double-clicked update) and against loads that resolve after teardown:
  // only the newest generation commits; anything stale rolls itself back.
  // unloadAll bumps every generation instead of latching a closed flag, so a
  // StrictMode remount (same host instance) can still load plugins afterwards.
  const loadGeneration = new Map<string, number>();

  return {
    commands,
    statusBarItems,
    remarkPlugins,
    rehypePlugins,
    fencedRenderers,
    async load(plugin, importer) {
      if (!satisfiesApiVersion(plugin.apiVersion)) {
        throw new Error(
          `${plugin.name} requires plugin API ${plugin.apiVersion}, but this Glyph provides ${PLUGIN_API_VERSION}`,
        );
      }
      const generation = (loadGeneration.get(plugin.id) ?? 0) + 1;
      loadGeneration.set(plugin.id, generation);

      const module = await importPluginModule(plugin.mainSource, importer);
      const bag = new DisposerBag();
      try {
        await module.activate(buildContext(bag));
      } catch (err) {
        bag.dispose(); // roll back anything registered before the throw
        throw err;
      }
      // Superseded by a newer load, or the host has been torn down: undo this
      // activation instead of committing a leaked instance.
      if (loadGeneration.get(plugin.id) !== generation) {
        bag.dispose();
        try {
          module.deactivate?.();
        } catch (err) {
          console.error(`Plugin ${plugin.id} threw in deactivate():`, err);
        }
        return;
      }
      // The previous instance stays live while the new one downloads and
      // activates; swap only at commit time.
      unload(plugin.id);
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
      // Invalidate in-flight loads too, not just committed instances.
      for (const [id, generation] of loadGeneration) {
        loadGeneration.set(id, generation + 1);
      }
      for (const id of [...loaded.keys()]) unload(id);
    },
    listLoaded() {
      return [...loaded.values()].map((p) => p.info);
    },
  };
}
