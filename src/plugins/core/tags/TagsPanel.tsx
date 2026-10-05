import { useMemo, useSyncExternalStore } from "react";
import { buildTagTree } from "./buildTagTree";
import { TagTree } from "./TagTree";
import type { TagsStore } from "./tagsStore";

interface TagsPanelProps {
  store: TagsStore;
  emptyLabel: string;
  filterLabel: (tag: string) => string;
}

// Workspace tags, alphabetical until the user toggles frequency. Selecting one
// filters the Files panel to the documents carrying it (or any tag nested under
// it); selecting it again clears the filter. Stays rendered while empty so the
// panel below the tree keeps a stable height.
export function TagsPanel({ store, emptyLabel, filterLabel }: TagsPanelProps) {
  const { tags, sort, selected } = useSyncExternalStore(store.subscribe, store.get);
  const tree = useMemo(() => buildTagTree(tags, sort), [tags, sort]);

  if (tags.length === 0) {
    return <p className="px-2 text-xs text-[var(--color-text-tertiary)]">{emptyLabel}</p>;
  }
  return (
    <TagTree nodes={tree} selected={selected} filterLabel={filterLabel} onSelect={store.select} />
  );
}
