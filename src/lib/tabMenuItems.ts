// Builds the items for the tab strip's right-click menu. Pure like
// `contextMenuItems`: no React, so the item set per tab position is unit
// testable on its own.

import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { TFunction } from "i18next";
import type { Tab } from "@/hooks/useTabs";
import { type ContextMenuItem, copySelection, joinGroups } from "./contextMenuItems";

export function buildTabMenuItems(
  tabs: Tab[],
  targetId: string,
  closeTabs: (ids: string[]) => void,
  t: TFunction<"common">,
): ContextMenuItem[] {
  const index = tabs.findIndex((tab) => tab.id === targetId);
  if (index === -1) return [];
  const target = tabs[index];
  const ids = tabs.map((tab) => tab.id);
  const before = ids.slice(0, index);
  const after = ids.slice(index + 1);
  const others = [...before, ...after];

  const close: ContextMenuItem[] = [
    {
      kind: "action",
      label: t("tabBar.contextMenu.close"),
      onSelect: () => closeTabs([targetId]),
    },
  ];
  if (others.length > 0) {
    close.push({
      kind: "action",
      label: t("tabBar.contextMenu.closeOthers"),
      onSelect: () => closeTabs(others),
    });
  }
  if (after.length > 0) {
    close.push({
      kind: "action",
      label: t("tabBar.contextMenu.closeToRight"),
      onSelect: () => closeTabs(after),
    });
  }
  if (before.length > 0) {
    close.push({
      kind: "action",
      label: t("tabBar.contextMenu.closeToLeft"),
      onSelect: () => closeTabs(before),
    });
  }
  // With a single tab open this would repeat Close, so it only appears once
  // there is more than one tab to close.
  if (others.length > 0) {
    close.push({
      kind: "action",
      label: t("tabBar.contextMenu.closeAll"),
      onSelect: () => closeTabs(ids),
    });
  }

  const path: ContextMenuItem[] = [];
  if (target.kind === "file") {
    const filePath = target.file.path;
    path.push(
      {
        kind: "action",
        label: t("fileTree.copyPath"),
        onSelect: () => copySelection(filePath),
      },
      {
        kind: "action",
        label: t("fileTree.reveal"),
        onSelect: () => void revealItemInDir(filePath),
      },
    );
  }

  return joinGroups([close, path]);
}
