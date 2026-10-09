import { useSyncExternalStore } from "react";
import { SortByCountIcon } from "./SortByCountIcon";
import type { TagsStore } from "./tagsStore";

interface TagsHeadingProps {
  store: TagsStore;
  sortLabel: string;
}

/** What follows the block's title: the tag count and the sort toggle. */
export function TagsHeading({ store, sortLabel }: TagsHeadingProps) {
  const { tags, sort } = useSyncExternalStore(store.subscribe, store.get);
  const sortedByCount = sort === "count";
  const tone = sortedByCount
    ? "text-[var(--color-text-primary)] bg-[var(--color-surface-tertiary)]"
    : "text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]";

  return (
    <>
      <span className="text-xs text-[var(--color-text-tertiary)]">{tags.length}</span>
      {tags.length > 0 && (
        <button
          type="button"
          onClick={store.toggleSort}
          className={`tags-sort pressable ms-auto p-0.5 rounded-[var(--glyph-radius-sm)] hover:bg-[var(--color-surface-tertiary)] transition-colors ${tone}`}
          title={sortLabel}
          aria-label={sortLabel}
          aria-pressed={sortedByCount}
        >
          <SortByCountIcon />
        </button>
      )}
    </>
  );
}
