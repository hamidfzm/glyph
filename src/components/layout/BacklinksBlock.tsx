import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useSidebarLayoutContext } from "@/contexts/SidebarLayoutContext";
import { useTabsContext } from "@/contexts/TabsContext";
import { usePanelResize } from "@/hooks/usePanelResize";
import { BACKLINKS_HEIGHT_MIN } from "@/lib/settings";
import { BacklinksSection } from "./BacklinksSection";
import { ResizeHandle } from "./ResizeHandle";

// Keep at least this much of the Files panel for the tree when dragging the
// backlinks divider up.
const BACKLINKS_TREE_RESERVE = 120;

interface BacklinksBlockProps {
  workspaceRoot: string;
  onOpen: (path: string) => void;
}

/** Backlinks pinned to the bottom of the Files panel, with the drag divider
 *  that resizes them against the tree above. Renders nothing without backlinks. */
export function BacklinksBlock({ workspaceRoot, onOpen }: BacklinksBlockProps) {
  const { t } = useTranslation("common");
  const { backlinks } = useTabsContext();
  const { backlinksHeight, setBacklinksHeight } = useSidebarLayoutContext();
  const blockRef = useRef<HTMLDivElement>(null);

  const maxHeight = useCallback(
    () =>
      Math.max(
        BACKLINKS_HEIGHT_MIN,
        (blockRef.current?.parentElement?.clientHeight ?? 0) - BACKLINKS_TREE_RESERVE,
      ),
    [],
  );
  // The idle height is DOM-measured so a drag starts from the rendered height
  // even when the block is auto-sized; it is also the idle aria value, and on
  // the first render the ref is not attached yet, so the minimum stands in.
  const measure = useCallback(() => blockRef.current?.offsetHeight ?? BACKLINKS_HEIGHT_MIN, []);
  const resize = usePanelResize({
    size: measure,
    min: BACKLINKS_HEIGHT_MIN,
    max: maxHeight,
    axis: "y",
    // The block sits at the panel bottom: dragging the divider up grows it.
    direction: -1,
    onCommit: setBacklinksHeight,
    onReset: () => setBacklinksHeight(null),
  });

  if (backlinks.length === 0) return null;

  return (
    <>
      <ResizeHandle
        axis="y"
        label={t("sidebar.resizeBacklinks")}
        value={resize.size ?? backlinksHeight ?? measure()}
        min={BACKLINKS_HEIGHT_MIN}
        max={maxHeight()}
        className="mt-3 -mx-3 h-1.5 shrink-0"
        {...resize.handleProps}
      />
      <div
        ref={blockRef}
        className="pt-1.5 border-t border-[var(--color-border)] shrink-0 overflow-y-auto"
        style={{ height: resize.size ?? backlinksHeight ?? undefined }}
      >
        <BacklinksSection backlinks={backlinks} workspaceRoot={workspaceRoot} onOpen={onOpen} />
      </div>
    </>
  );
}
