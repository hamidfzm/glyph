import { type CSSProperties, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TagCount } from "@/lib/metadata";
import { tagHue } from "@/lib/tagColor";

interface TagsSectionProps {
  tags: TagCount[];
  /** The tag currently filtering the file list, if any. */
  selected: string | null;
  onSelect: (tag: string | null) => void;
}

// Workspace tags, most frequent first. Selecting one filters the Files panel
// to the documents carrying it; selecting it again clears the filter.
export function TagsSection({ tags, selected, onSelect }: TagsSectionProps) {
  const { t } = useTranslation("common");
  const [collapsed, setCollapsed] = useState(false);

  if (tags.length === 0) return null;

  return (
    <section>
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex items-center gap-1 w-full text-start text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider mb-2 hover:text-[var(--color-text-secondary)] transition-colors"
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
        <ul className="flex flex-wrap gap-1.5">
          {tags.map(({ tag, count }) => (
            <li key={tag}>
              <button
                type="button"
                onClick={() => onSelect(selected === tag ? null : tag)}
                className="tag-chip"
                style={{ "--tag-h": tagHue(tag) } as CSSProperties}
                aria-pressed={selected === tag}
                title={t("tags.filterBy", { tag })}
              >
                <span className="tag-chip-hash" aria-hidden="true">
                  #
                </span>
                {tag}
                <span className="tag-chip-count">{count}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
