import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ResizableBlock } from "@/components/layout/ResizableBlock";
import { useFilesBlockLayout } from "@/hooks/useFilesBlockLayout";
import { filesBlockKey } from "@/lib/plugins/filesBlocks";
import type { MountContribution, SidebarPanelEntry } from "@/lib/plugins/types";
import { PluginMountSlot } from "./PluginMountSlot";

const DEFAULT_MIN_HEIGHT = 56;

/**
 * One plugin panel placed in the Files panel: the host draws the heading the
 * user collapses it with and the divider that resizes it, the plugin fills the
 * body and, optionally, the rest of the heading.
 */
export function PluginFilesBlock({ panel }: { panel: SidebarPanelEntry }) {
  const { t } = useTranslation("common");
  const { height, collapsed, setHeight, setCollapsed } = useFilesBlockLayout(filesBlockKey(panel));
  const heading = useMemo<MountContribution | null>(
    () => (panel.mountHeading ? { id: `${panel.id}:heading`, mount: panel.mountHeading } : null),
    [panel],
  );

  return (
    <ResizableBlock
      label={t("sidebar.resizeBlock", { name: panel.title })}
      min={panel.frame?.min ?? DEFAULT_MIN_HEIGHT}
      height={height}
      onHeightCommit={setHeight}
      naturalMax={panel.frame?.naturalMax}
      collapsed={collapsed}
    >
      <section data-collapsed={collapsed ? "" : undefined}>
        <div className="flex items-center gap-1 mb-2">
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            className="flex items-center gap-1 min-w-0 text-start text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider hover:text-[var(--color-text-secondary)] transition-colors"
            aria-expanded={!collapsed}
          >
            <span aria-hidden="true" className="inline-block w-3">
              {collapsed ? "▸" : "▾"}
            </span>
            <span className="truncate">{panel.title}</span>
          </button>
          {heading && (
            <PluginMountSlot
              contribution={heading}
              className="flex flex-1 min-w-0 items-center gap-1"
            />
          )}
        </div>
        {/* Hidden, not unmounted: the plugin keeps its state across a collapse. */}
        <div hidden={collapsed}>
          <PluginMountSlot contribution={panel} className="block" />
        </div>
      </section>
    </ResizableBlock>
  );
}
