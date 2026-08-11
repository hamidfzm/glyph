import { useTranslation } from "react-i18next";
import { useSidebarLayoutContext } from "@/contexts/SidebarLayoutContext";
import { useDrawerGesture } from "@/hooks/useDrawerGesture";
import { usePanelResize } from "@/hooks/usePanelResize";
import { drawerPhysicalEdge } from "@/lib/gesture";
import { SIDEBAR_WIDTH_DEFAULT, SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN } from "@/lib/settings";
import { ResizeHandle } from "./ResizeHandle";

// A sidebar column with a border on the edge facing the content area. Holds
// the file-tree and/or outline blocks; they scroll inside an inner wrapper so
// the resize handle stays pinned to the panel edge. That edge is a drag
// handle: drag to resize, double-click to restore the default width.
export function SidebarPanel({
  width,
  side,
  onWidthCommit,
  children,
}: {
  width: number;
  side: "left" | "right";
  onWidthCommit: (width: number) => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation("common");
  const { compact, closeCompactPanels, drawerDismissals } = useSidebarLayoutContext();
  const { size, handleProps } = usePanelResize({
    size: width,
    min: SIDEBAR_WIDTH_MIN,
    max: SIDEBAR_WIDTH_MAX,
    axis: "x",
    // `side` is the panel's slot in LTR flex order; under RTL the rendered
    // position mirrors, flipping which pointer direction grows the panel.
    direction: () => ((side === "left") === (document.documentElement.dir !== "rtl") ? 1 : -1),
    onCommit: onWidthCommit,
    onReset: () => onWidthCommit(SIDEBAR_WIDTH_DEFAULT),
  });
  // Same LTR/RTL resolution as `direction`, for the drawer's travel axis.
  const physicalEdge = drawerPhysicalEdge(side, document.documentElement.dir === "rtl");
  const drawer = useDrawerGesture({
    enabled: compact,
    edge: physicalEdge,
    dismissals: drawerDismissals,
    close: closeCompactPanels,
  });
  const borderClass = side === "left" ? "border-e" : "border-s";
  // Compact (phone): the panel is a drawer overlaying the document, absolutely
  // positioned against its edge and capped so it never covers the whole screen,
  // rather than a flex column that squeezes the content into a sliver. It is
  // also a gesture sheet: springs in, drags 1:1, flicks shut.
  const layoutClass = compact
    ? `sidebar-drawer absolute inset-y-0 ${side === "left" ? "start-0" : "end-0"} z-20 max-w-[85%] shadow-xl`
    : "relative shrink-0";
  return (
    <nav
      ref={drawer.ref}
      data-print-hide="true"
      data-sidebar={side}
      data-drawer-edge={compact ? physicalEdge : undefined}
      className={`sidebar-panel ${layoutClass} flex ${borderClass} border-[var(--color-border)] select-none`}
      style={{ width: size }}
      {...(compact ? drawer.handlers : {})}
    >
      <div className="flex-1 min-w-0 flex flex-col overflow-y-auto pt-3">{children}</div>
      <ResizeHandle
        axis="x"
        label={t("sidebar.resize")}
        value={size}
        min={SIDEBAR_WIDTH_MIN}
        max={SIDEBAR_WIDTH_MAX}
        className={`absolute inset-y-0 w-1.5 ${side === "left" ? "end-0" : "start-0"}`}
        {...handleProps}
      />
    </nav>
  );
}
