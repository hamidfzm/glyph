import { useZoomApi } from "@/contexts/ZoomContext";

/** Stand-ins for the Zoom In/Out/Actual-Size menu commands. */
export function ZoomButtons() {
  const api = useZoomApi();
  return (
    <>
      <button type="button" onClick={() => api?.actions.zoomIn()}>
        cmd-zoom-in
      </button>
      <button type="button" onClick={() => api?.actions.zoomOut()}>
        cmd-zoom-out
      </button>
      <button type="button" onClick={() => api?.actions.zoomReset()}>
        cmd-zoom-reset
      </button>
    </>
  );
}
