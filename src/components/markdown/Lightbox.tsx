import { type MouseEvent, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ChevronLeftIcon } from "@/components/icons/ChevronLeftIcon";
import { ChevronRightIcon } from "@/components/icons/ChevronRightIcon";
import { ModalCloseIcon } from "@/components/icons/ModalCloseIcon";
import { useDragPan } from "@/hooks/useDragPan";
import { useLightboxKeys } from "@/hooks/useLightboxKeys";
import { useWindowFullscreen } from "@/hooks/useWindowFullscreen";
import {
  clampScale,
  fitScale,
  fitWidthScale,
  type LightboxItem,
  type NaturalSize,
} from "@/lib/lightbox";
import { LightboxImage } from "./LightboxImage";
import { LightboxTable } from "./LightboxTable";
import { LightboxToolbar } from "./LightboxToolbar";

const WHEEL_ZOOM_SPEED = 0.0015;

interface LightboxProps {
  items: LightboxItem[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

// Full-screen viewer for images, diagrams, and tables: dark backdrop, zoom
// controls (fit, actual size, zoom in/out), and arrow-key navigation between
// the document's images. Zoomed content scrolls rather than clips: an image in
// the stage itself, a table in a scroll box of its own.
export function Lightbox({ items, index, onIndexChange, onClose }: LightboxProps) {
  const { t } = useTranslation("common");
  const item = items[index];
  const isTable = item?.kind === "table";
  const stageRef = useRef<HTMLDivElement>(null);
  const tableScrollerRef = useRef<HTMLDivElement>(null);
  useDragPan(stageRef);
  const [scale, setScale] = useState(1);
  const [isFit, setIsFit] = useState(true);
  // The content's natural size for the fit math, reported by the stage: null
  // until measured, or for an image with no intrinsic size.
  const naturalRef = useRef<NaturalSize | null>(null);

  const hasMultiple = items.length > 1;

  const computeFit = useCallback(() => {
    const size = naturalRef.current;
    if (!size) return 1;
    // Only a mounted stage reports a size, so the refs below are set.
    // A table's scroll box already sits inside the padding, less its scrollbar.
    if (isTable) return fitWidthScale(size.w, tableScrollerRef.current!.clientWidth);
    const stage = stageRef.current!;
    // Subtract the overlay padding so a fitted image clears the toolbar/edges.
    const styles = getComputedStyle(stage);
    const availWidth =
      stage.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight);
    const availHeight =
      stage.clientHeight - parseFloat(styles.paddingTop) - parseFloat(styles.paddingBottom);
    return fitScale(size.w, size.h, availWidth, availHeight);
  }, [isTable]);

  const applyFit = useCallback(() => {
    setScale(computeFit());
    setIsFit(true);
  }, [computeFit]);

  const zoomBy = useCallback((factor: number) => {
    setScale((s) => clampScale(s * factor));
    setIsFit(false);
  }, []);

  const actualSize = useCallback(() => {
    setScale(1);
    setIsFit(false);
  }, []);

  const goTo = useCallback(
    (next: number) => {
      if (next < 0 || next >= items.length) return;
      naturalRef.current = null;
      onIndexChange(next);
    },
    [items.length, onIndexChange],
  );

  const handleMeasure = useCallback(
    (size: NaturalSize | null) => {
      naturalRef.current = size;
      applyFit();
    },
    [applyFit],
  );

  useLightboxKeys({
    hasMultiple,
    index,
    onGoTo: goTo,
    onZoomBy: zoomBy,
    onFit: applyFit,
    onActualSize: actualSize,
    onClose,
  });

  // Keep the content fitted when the window resizes, unless the user has zoomed.
  useEffect(() => {
    if (!isFit) return;
    const handleResize = () => setScale(computeFit());
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [isFit, computeFit]);

  useWindowFullscreen();

  // Ctrl/Cmd + wheel zooms; a plain wheel keeps panning a zoomed image. Native
  // non-passive listener so preventDefault cancels the scroll.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setScale((s) => clampScale(s * Math.exp(-event.deltaY * WHEEL_ZOOM_SPEED)));
      setIsFit(false);
    };
    stage.addEventListener("wheel", handleWheel, { passive: false });
    return () => stage.removeEventListener("wheel", handleWheel);
  }, []);

  // A table opens from a keyboard-reachable button: take focus so the arrow and
  // page keys scroll it, not the document behind.
  useEffect(() => {
    if (isTable) tableScrollerRef.current?.focus();
  }, [isTable]);

  if (!item) return null;

  let label = t("lightbox.viewer");
  if (item.kind === "table") label = t("lightbox.tableViewer");
  else if (item.alt) label = t("lightbox.image", { alt: item.alt });

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const target = event.target as Element;
    // Following a link out of a table leaves the lightbox for wherever it leads.
    if (target.closest('a[href]:not([aria-disabled="true"])')) {
      onClose();
      return;
    }
    const isBackdrop = target === event.currentTarget || target === tableScrollerRef.current;
    if (!isBackdrop) return;
    // A text selection dragged out past the table ends in a click on the backdrop.
    const selection = window.getSelection();
    if (selection?.toString() && event.currentTarget.contains(selection.anchorNode)) return;
    onClose();
  };

  // The dialog is the backdrop and an image's scroll container: clicking it
  // directly (i.e. the empty area around the content) closes. The controls
  // below are `position: fixed`, so they stay pinned while zoomed content scrolls.
  // Portaled to <body>: a transformed ancestor (canvas cards render markdown
  // inside the pan/zoom world) would otherwise become the containing block and
  // trap the "full-screen" overlay inside the pane.
  return createPortal(
    <div
      ref={stageRef}
      className="lightbox-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      data-print-hide="true"
      // React bubbles a portal's events up the tree that rendered it (a canvas
      // card would start a move or an edit); the modal keeps its presses.
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <button
        type="button"
        className="lightbox-button lightbox-close"
        onClick={onClose}
        aria-label={t("lightbox.close")}
        title={t("lightbox.close")}
      >
        <ModalCloseIcon />
      </button>

      {hasMultiple && (
        <button
          type="button"
          className="lightbox-button lightbox-nav lightbox-prev"
          onClick={() => goTo(index - 1)}
          disabled={index === 0}
          aria-label={t("lightbox.previous")}
          title={t("lightbox.previous")}
        >
          <ChevronLeftIcon className="w-5 h-5" />
        </button>
      )}

      {item.kind === "table" ? (
        <LightboxTable
          table={item}
          scale={scale}
          scrollerRef={tableScrollerRef}
          onMeasure={handleMeasure}
        />
      ) : (
        <LightboxImage image={item} scale={scale} onMeasure={handleMeasure} />
      )}

      {hasMultiple && (
        <button
          type="button"
          className="lightbox-button lightbox-nav lightbox-next"
          onClick={() => goTo(index + 1)}
          disabled={index === items.length - 1}
          aria-label={t("lightbox.next")}
          title={t("lightbox.next")}
        >
          <ChevronRightIcon className="w-5 h-5" />
        </button>
      )}

      <LightboxToolbar
        scale={scale}
        index={index}
        total={items.length}
        onZoomBy={zoomBy}
        onFit={applyFit}
        onActualSize={actualSize}
      />
    </div>,
    document.body,
  );
}
