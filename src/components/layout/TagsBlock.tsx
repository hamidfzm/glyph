import { useTranslation } from "react-i18next";
import { useSidebarLayoutContext } from "@/contexts/SidebarLayoutContext";
import type { TagCount } from "@/lib/metadata";
import { TAGS_HEIGHT_MIN } from "@/lib/settings";
import { ResizableBlock } from "./ResizableBlock";
import { TagsSection } from "./TagsSection";

// Height the tag cloud grows to on its own before scrolling, until the user
// drags the divider.
const TAGS_HEIGHT_NATURAL_MAX = 160;

interface TagsBlockProps {
  tags: TagCount[];
  /** The tag currently filtering the file list, if any. */
  selected: string | null;
  onSelect: (tag: string | null) => void;
}

/** The workspace tag cloud in the Files panel, resizable against the tree
 *  above. */
export function TagsBlock({ tags, selected, onSelect }: TagsBlockProps) {
  const { t } = useTranslation("common");
  const { tagsHeight, setTagsHeight, tagsCollapsed, setTagsCollapsed } = useSidebarLayoutContext();

  return (
    <ResizableBlock
      label={t("sidebar.resizeTags")}
      min={TAGS_HEIGHT_MIN}
      height={tagsHeight}
      onHeightCommit={setTagsHeight}
      naturalMax={TAGS_HEIGHT_NATURAL_MAX}
      collapsed={tagsCollapsed}
    >
      <TagsSection
        tags={tags}
        selected={selected}
        collapsed={tagsCollapsed}
        onToggleCollapsed={() => setTagsCollapsed(!tagsCollapsed)}
        onSelect={onSelect}
      />
    </ResizableBlock>
  );
}
