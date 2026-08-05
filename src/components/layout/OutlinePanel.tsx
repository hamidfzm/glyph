import { useTranslation } from "react-i18next";
import { PluginSidebarPanels } from "@/components/plugins/PluginSidebarPanels";
import { useSidebarLayoutContext } from "@/contexts/SidebarLayoutContext";
import { useTabsContext } from "@/contexts/TabsContext";
import { useActiveHeading } from "@/hooks/useActiveHeading";
import { OutlineSection } from "./OutlineSection";
import { PanelHeader } from "./PanelHeader";

interface OutlinePanelProps {
  /** Physical side the panel sits on, so the header's collapse chevron points out. */
  headerSide: "left" | "right";
}

/** The Outline panel body: the active document's headings plus any
 *  plugin-contributed sidebar panels. */
export function OutlinePanel({ headerSide }: OutlinePanelProps) {
  const { t } = useTranslation("common");
  const { tocEntries } = useTabsContext();
  const { toggleOutline } = useSidebarLayoutContext();
  const activeId = useActiveHeading(tocEntries);

  return (
    <div className="px-3 pb-3">
      <PanelHeader
        label={t("sidebar.outline")}
        side={headerSide}
        onCollapse={toggleOutline}
        collapseTitle={t("sidebar.hideOutline")}
      />
      <OutlineSection entries={tocEntries} activeId={activeId} />
      <PluginSidebarPanels />
    </div>
  );
}
