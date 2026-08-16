import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SortByCountIcon } from "@/components/icons/SortByCountIcon";
import type { TagCount } from "@/lib/metadata";
import { buildTagTree, type TagSort } from "@/lib/tagTree";
import { TagTree } from "./TagTree";
import { ToolbarButton } from "./ToolbarButton";

interface TagsSectionProps {
  tags: TagCount[];
  /** The tag currently filtering the file list, if any. */
  selected: string | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSelect: (tag: string | null) => void;
}

// Workspace tags, alphabetical until the user toggles frequency. Selecting one
// filters the Files panel to the documents carrying it (or any tag nested under
// it); selecting it again clears the filter. Stays rendered while empty so the
// panel below the tree keeps a stable height.
export function TagsSection({
  tags,
  selected,
  collapsed,
  onToggleCollapsed,
  onSelect,
}: TagsSectionProps) {
  const { t } = useTranslation("common");
  const [sort, setSort] = useState<TagSort>("name");
  const tree = useMemo(() => buildTagTree(tags, sort), [tags, sort]);

  return (
    <section>
      <div className="flex items-center gap-1 mb-2">
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="flex items-center gap-1 flex-1 min-w-0 text-start text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider hover:text-[var(--color-text-secondary)] transition-colors"
          aria-expanded={!collapsed}
        >
          <span aria-hidden="true" className="inline-block w-3">
            {collapsed ? "▸" : "▾"}
          </span>
          <span>{t("tags.heading")}</span>
          <span className="text-[var(--color-text-tertiary)] font-normal normal-case tracking-normal">
            {tags.length}
          </span>
        </button>
        {!collapsed && tags.length > 0 && (
          <ToolbarButton
            title={t("tags.sortByCount")}
            pressed={sort === "count"}
            onClick={() => setSort(sort === "count" ? "name" : "count")}
          >
            <SortByCountIcon />
          </ToolbarButton>
        )}
      </div>
      {!collapsed && tags.length === 0 && (
        <p className="px-2 text-xs text-[var(--color-text-tertiary)]">{t("tags.empty")}</p>
      )}
      {!collapsed && tags.length > 0 && (
        <TagTree nodes={tree} selected={selected} onSelect={onSelect} />
      )}
    </section>
  );
}
