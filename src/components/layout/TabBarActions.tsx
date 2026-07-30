import { useTranslation } from "react-i18next";
import { useOpenGraph, useTabsContext } from "@/contexts/TabsContext";
import { actionBarItems } from "@/lib/actionBarItems";
import { ActionBarButton } from "./ActionBarButton";

interface TabBarActionsProps {
  onOpenPalette: () => void;
}

export function TabBarActions({ onOpenPalette }: TabBarActionsProps) {
  const { t } = useTranslation("common");
  const { workspace } = useTabsContext();
  const openGraph = useOpenGraph();
  const items = actionBarItems({
    openPalette: onOpenPalette,
    openGraph,
    hasWorkspace: workspace !== null,
  });

  return (
    <div className="mode-toggle">
      {items.map(({ id, labelKey, Icon, run }) => (
        <ActionBarButton key={id} onClick={run} label={t(labelKey)}>
          <Icon />
        </ActionBarButton>
      ))}
    </div>
  );
}
