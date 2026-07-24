import { type CSSProperties, type ReactNode, useEffect, useRef } from "react";
import { useNoteZoomMap, useZoomApi } from "@/contexts/ZoomContext";
import { useSettings } from "@/hooks/useSettings";
import { TAB_ZOOM_DEFAULT, tabZoomByWheel, tabZoomIn, tabZoomOut } from "@/lib/tabZoom";

interface NoteZoomLayerProps {
  /** The active tab, so the multiplier is stored (and restored) per tab. */
  tabId: string;
  children: ReactNode;
}

// Wraps a note surface (markdown view/edit/split) with a temporary, per-tab font
// zoom. The multiplier scales the saved font size through an inline
// `--glyph-font-size` override; it lives in ZoomProvider state, so it survives
// tab switches but is never persisted. Ctrl/Cmd + wheel and the Zoom
// In/Out/Actual-Size commands drive it.
export function NoteZoomLayer({ tabId, children }: NoteZoomLayerProps) {
  const { settings } = useSettings();
  const api = useZoomApi();
  const noteZoomMap = useNoteZoomMap();
  const ref = useRef<HTMLDivElement>(null);
  const zoom = noteZoomMap?.[tabId] ?? TAB_ZOOM_DEFAULT;

  const setNoteZoom = api?.setNoteZoom;
  const registerTarget = api?.registerTarget;

  // Register the Zoom In/Out/Actual-Size handlers while this note tab is active.
  useEffect(() => {
    if (!setNoteZoom || !registerTarget) return;
    registerTarget({
      zoomIn: () => setNoteZoom(tabId, tabZoomIn),
      zoomOut: () => setNoteZoom(tabId, tabZoomOut),
      zoomReset: () => setNoteZoom(tabId, () => TAB_ZOOM_DEFAULT),
    });
    return () => registerTarget(null);
  }, [tabId, setNoteZoom, registerTarget]);

  // Ctrl/Cmd + wheel zooms instead of scrolling. A native non-passive listener
  // so preventDefault actually cancels the scroll (React's onWheel is passive).
  useEffect(() => {
    const el = ref.current;
    if (!el || !setNoteZoom) return;
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setNoteZoom(tabId, (current) => tabZoomByWheel(current, event.deltaY));
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [tabId, setNoteZoom]);

  const style = {
    "--glyph-font-size": `${settings.appearance.fontSize * zoom}px`,
  } as CSSProperties;

  return (
    <div ref={ref} className="flex flex-col flex-1 min-h-0 min-w-0" style={style}>
      {children}
    </div>
  );
}
