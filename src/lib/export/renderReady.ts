import { pendingDocumentAssets } from "@/lib/documentAssets";
import { documentBody } from "@/lib/documentBody";
import { pendingPluginLoads } from "@/lib/markdown/pluginLoads";

// Diagrams and math render asynchronously after the document mounts (diagram
// and math plugins, highlighting, and gemoji all load lazily), so an export that
// fired on mount would write a document with empty diagram slots
// and unrendered shortcodes. Wait for the rendered body to appear and settle.

// How long the body must go unchanged before it counts as settled. Long enough
// to bridge the gap between one diagram finishing and the next starting, short
// enough not to pad every export.
const QUIET_MS = 250;

// The root an export snapshots: the active document, or a canvas board. A
// board counts because its cards hold their own markdown bodies, so it has the
// same lazy content to wait on; leaving it out made a board export sit here
// until the deadline.
export function exportableRoot(): Element | null {
  return documentBody() ?? document.querySelector(".glyph-canvas");
}

/** Plugin renders (diagrams) that mark themselves `aria-busy` while pending. */
function pendingDiagrams(root: ParentNode): number {
  return root.querySelectorAll('[aria-busy="true"]').length;
}

/**
 * Resolve once the rendered document has appeared and stopped changing with no
 * diagram left empty, no lazy plugin still loading, and no loose-file asset
 * still waiting on the backend (its image has no src yet), or when `timeoutMs`
 * elapses. The plugin check matters on its own: a document waiting for the
 * gemoji or math chunk mutates nothing, so quiet alone would mean "finished"
 * while the swap is still coming. The timeout is the CI guard:
 * one diagram that never resolves must not hang the process forever, so the
 * export proceeds with whatever rendered. A diagram missing from the output is
 * visible; a hung job is not.
 *
 * Reports whether the document settled on its own so the caller can tell the
 * two apart.
 */
export function waitForRenderIdle(timeoutMs = 15_000): Promise<{ settled: boolean }> {
  return new Promise((resolve) => {
    let quietTimer = 0;
    let deadline = 0;
    const observer = new MutationObserver(() => armQuietTimer());

    function finish(settled: boolean) {
      window.clearTimeout(quietTimer);
      window.clearTimeout(deadline);
      observer.disconnect();
      resolve({ settled });
    }

    function armQuietTimer() {
      window.clearTimeout(quietTimer);
      quietTimer = window.setTimeout(() => {
        const root = exportableRoot();
        // Quiet but incomplete means the document is still loading, or a
        // diagram is between frames; keep waiting for the deadline to decide.
        const isComplete =
          root !== null &&
          pendingDiagrams(root) === 0 &&
          pendingPluginLoads() === 0 &&
          pendingDocumentAssets() === 0;
        if (isComplete) finish(true);
        else armQuietTimer();
      }, QUIET_MS);
    }

    deadline = window.setTimeout(() => finish(false), timeoutMs);
    // Observed from the root, not the body: on a CLI launch the document is
    // still being opened and the body element does not exist yet.
    observer.observe(document.documentElement, { childList: true, subtree: true });
    armQuietTimer();
  });
}
