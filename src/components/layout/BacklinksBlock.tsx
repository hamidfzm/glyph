import { useTranslation } from "react-i18next";
import { useSidebarLayoutContext } from "@/contexts/SidebarLayoutContext";
import { useTabsContext } from "@/contexts/TabsContext";
import { BACKLINKS_HEIGHT_MIN } from "@/lib/settings";
import { BacklinksSection } from "./BacklinksSection";
import { ResizableBlock } from "./ResizableBlock";

interface BacklinksBlockProps {
  workspaceRoot: string;
  onOpen: (path: string) => void;
}

/** Backlinks pinned to the bottom of the Files panel, resizable against the
 *  tree above. Renders nothing without backlinks. */
export function BacklinksBlock({ workspaceRoot, onOpen }: BacklinksBlockProps) {
  const { t } = useTranslation("common");
  const { backlinks } = useTabsContext();
  const { backlinksHeight, setBacklinksHeight } = useSidebarLayoutContext();

  if (backlinks.length === 0) return null;

  return (
    <ResizableBlock
      label={t("sidebar.resizeBacklinks")}
      min={BACKLINKS_HEIGHT_MIN}
      height={backlinksHeight}
      onHeightCommit={setBacklinksHeight}
    >
      <BacklinksSection backlinks={backlinks} workspaceRoot={workspaceRoot} onOpen={onOpen} />
    </ResizableBlock>
  );
}
