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
  onSelect: (tag: string | null) => void;
}

// Workspace tags, alphabetical until the user toggles frequency. Selecting one
// filters the Files panel to the documents carrying it (or any tag nested under
// it); selecting it again clears the filter.
export function TagsSection({ tags, selected, onSelect }: TagsSectionProps) {
  const { t } = useTranslation("common");
  const [collapsed, setCollapsed] = useState(false);
  const [sort, setSort] = useState<TagSort>("name");
  const tree = useMemo(() => buildTagTree(tags, sort), [tags, sort]);

  if (tags.length === 0) return null;

  return (
    <section>
      <div className="flex items-center gap-1 mb-2">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
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
        {!collapsed && (
          <ToolbarButton
            title={t("tags.sortByCount")}
            pressed={sort === "count"}
            onClick={() => setSort(sort === "count" ? "name" : "count")}
          >
            <SortByCountIcon />
          </ToolbarButton>
        )}
      </div>
      {!collapsed && <TagTree nodes={tree} selected={selected} onSelect={onSelect} />}
    </section>
  );
}
