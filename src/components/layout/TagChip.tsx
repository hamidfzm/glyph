import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { tagHue } from "@/lib/tagColor";

interface TagChipProps {
  /** Full tag path, which is what selecting the chip filters by. */
  tag: string;
  /** Text on the chip: a nested tag shows only its tail, the parent carries the prefix. */
  label: string;
  count: number;
  selected: boolean;
  onSelect: (tag: string | null) => void;
}

export function TagChip({ tag, label, count, selected, onSelect }: TagChipProps) {
  const { t } = useTranslation("common");
  // Two nested tags can share a tail (`project/glyph`, `work/glyph`), so the
  // accessible name spells out the path the visible label truncates.
  const name = t("tags.filterBy", { tag });

  return (
    <button
      type="button"
      onClick={() => onSelect(selected ? null : tag)}
      className="tag-chip"
      style={{ "--tag-h": tagHue(tag) } as CSSProperties}
      aria-pressed={selected}
      aria-label={name}
      title={name}
    >
      <span className="tag-chip-hash" aria-hidden="true">
        #
      </span>
      {label}
      <span className="tag-chip-count">{count}</span>
    </button>
  );
}
