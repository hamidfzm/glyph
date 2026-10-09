import type { Disposer, GlyphPluginContext, TagCount } from "@/lib/plugins/types";
import type { TagSort } from "./buildTagTree";

export interface TagsState {
  tags: readonly TagCount[];
  sort: TagSort;
  /** The tag filtering the file list, if any. */
  selected: string | null;
}

export interface TagsStore {
  get(): TagsState;
  subscribe(listener: () => void): Disposer;
  toggleSort(): void;
  /** Filter the file list by `tag`; null clears the filter. */
  select(tag: string | null): void;
  /** Read the tags again and redraw the filter, e.g. after a language switch. */
  refresh(): void;
}

const NONE: readonly TagCount[] = [];

/**
 * The workspace's tags and the one filtering the file list, kept current as
 * the index or the workspace changes. One store feeds the block's body and its
 * heading.
 */
export function createTagsStore(
  ctx: Pick<GlyphPluginContext, "vault" | "workspace" | "ui">,
  filterLabel: (tag: string, total: number) => string,
): TagsStore {
  let state: TagsState = { tags: NONE, sort: "name", selected: null };
  let root: string | null = null;
  let removeFilter: Disposer | null = null;
  let latestTags = 0;
  let latestPaths = 0;
  const listeners = new Set<() => void>();

  const set = (next: TagsState) => {
    state = next;
    for (const listener of [...listeners]) listener();
  };

  const clearFilter = () => {
    removeFilter?.();
    removeFilter = null;
  };

  // The list on screen stays until the new one is ready, so the panel never
  // flashes back to the tree between two tags.
  const showFilter = (tag: string) => {
    const request = ++latestPaths;
    ctx.vault.pathsWithTag(tag).then(
      (paths) => {
        if (request !== latestPaths) return;
        clearFilter();
        removeFilter = ctx.ui.filterFileTree({
          label: filterLabel(tag, paths.length),
          paths,
          onClear: () => select(null),
        });
      },
      (err) => {
        console.error(`Failed to list files tagged ${tag}:`, err);
        if (request === latestPaths) select(null);
      },
    );
  };

  const select = (tag: string | null) => {
    latestPaths += 1;
    if (tag === null) clearFilter();
    set({ ...state, selected: tag });
    if (tag !== null) showFilter(tag);
  };

  const refresh = () => {
    const request = ++latestTags;
    const nextRoot = ctx.workspace.getRoot();
    // Neither a filter nor the tags outlive the workspace they came from.
    if (nextRoot !== root) {
      if (state.selected !== null) select(null);
      set({ ...state, tags: NONE });
    }
    root = nextRoot;
    if (!nextRoot) return;
    ctx.vault.tags().then(
      (tags) => {
        if (request !== latestTags) return;
        set({ ...state, tags });
        const selected = state.selected;
        if (selected === null) return;
        // A tag edited away falls back to the tree instead of stranding the
        // panel on a stale list.
        if (tags.some((entry) => entry.tag === selected)) showFilter(selected);
        else select(null);
      },
      (err) => console.error("Failed to read the workspace tags:", err),
    );
  };

  ctx.vault.onChange(refresh);
  ctx.workspace.onChange(refresh);
  refresh();

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    toggleSort: () => set({ ...state, sort: state.sort === "count" ? "name" : "count" }),
    select,
    refresh,
  };
}
