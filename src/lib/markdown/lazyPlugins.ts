// Rehype plugins registered as `{ detect, load }` load when the first document
// that needs them renders, not when their plugin activates. Each entry loads at
// most once: a plugin turned off and on again registers a new entry, and the
// module cache makes that second import cheap.

import type { LazyMarkdownPlugin, MarkdownPlugin } from "@/lib/plugins/types";
import { trackPluginLoad } from "./pluginLoads";

/** What `ctx.markdown.registerRehypePlugin` accepts. */
export type RehypeContribution = MarkdownPlugin | LazyMarkdownPlugin;

const loads = new WeakMap<LazyMarkdownPlugin, Promise<MarkdownPlugin | null>>();
const loaded = new WeakMap<LazyMarkdownPlugin, MarkdownPlugin>();
// Bumped whenever a load lands, so a cached ready list is rebuilt once.
let generation = 0;
const readyCache = new WeakMap<
  readonly RehypeContribution[],
  { generation: number; plugins: MarkdownPlugin[] }
>();

/** A lazy entry, as opposed to a plugin, a `[plugin, options]` tuple, or a preset. */
export function isLazyMarkdownPlugin(entry: RehypeContribution): entry is LazyMarkdownPlugin {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return false;
  const candidate = entry as Partial<LazyMarkdownPlugin>;
  return typeof candidate.detect === "function" && typeof candidate.load === "function";
}

// A throwing check is the plugin's bug; it must not take the document down.
function detects(entry: LazyMarkdownPlugin, markdown: string): boolean {
  try {
    return entry.detect(markdown);
  } catch (err) {
    console.error("A lazy markdown plugin's detect threw:", err);
    return false;
  }
}

// Resolves null when the load fails, which is logged once and never retried.
function loadOnce(entry: LazyMarkdownPlugin): Promise<MarkdownPlugin | null> {
  let load = loads.get(entry);
  if (!load) {
    load = trackPluginLoad(Promise.resolve().then(() => entry.load())).then(
      (plugin) => {
        loaded.set(entry, plugin);
        generation++;
        return plugin;
      },
      (err: unknown) => {
        console.error("A lazy markdown plugin failed to load:", err);
        return null;
      },
    );
    loads.set(entry, load);
  }
  return load;
}

/** Start the loads `markdown` needs. Resolves once they settle. */
export async function loadForDocument(
  entries: readonly RehypeContribution[],
  markdown: string,
): Promise<void> {
  const pending = entries.filter(
    (entry): entry is LazyMarkdownPlugin =>
      isLazyMarkdownPlugin(entry) && !loaded.has(entry) && detects(entry, markdown),
  );
  await Promise.all(pending.map(loadOnce));
}

/**
 * The plugins ready to run, in registration order: plain ones, and lazy ones
 * whose load has landed (a no-op on documents that don't need them). Returns
 * the same array until `entries` changes or another load lands.
 */
export function readyPlugins(entries: readonly RehypeContribution[]): MarkdownPlugin[] {
  const cached = readyCache.get(entries);
  if (cached?.generation === generation) return cached.plugins;
  const plugins = entries.flatMap((entry) => {
    if (!isLazyMarkdownPlugin(entry)) return [entry];
    const plugin = loaded.get(entry);
    return plugin ? [plugin] : [];
  });
  readyCache.set(entries, { generation, plugins });
  return plugins;
}

/** For a one-shot render: wait for the loads `markdown` needs, then the ready plugins. */
export async function resolveForDocument(
  entries: readonly RehypeContribution[],
  markdown: string,
): Promise<MarkdownPlugin[]> {
  await loadForDocument(entries, markdown);
  return readyPlugins(entries);
}
