// Diagrams and math render asynchronously after the document mounts (Mermaid
// and D2 compile in a worker, KaTeX loads lazily), so a CLI export that fired
// on mount would write a document with empty diagram slots. Wait for the
// rendered body to appear and then settle.

// How long the body must go unchanged before it counts as settled. Long enough
// to bridge the gap between one diagram finishing and the next starting, short
// enough not to pad every export.
const QUIET_MS = 250;

const BODY_SELECTOR = ".markdown-body, .notebook-body";

/** Diagram containers still waiting for their SVG (or their error message). */
function pendingDiagrams(root: ParentNode): number {
  return Array.from(root.querySelectorAll(".mermaid-diagram, .d2-diagram")).filter(
    (el) => el.childElementCount === 0,
  ).length;
}

/**
 * Resolve once the rendered document has appeared and stopped changing with no
 * diagram left empty, or when `timeoutMs` elapses. The timeout is the CI guard:
 * one diagram that never resolves must not hang the process forever, so the
 * export proceeds with whatever rendered. A diagram missing from the output is
 * visible; a hung job is not.
 *
 * Reports whether the document settled on its own so the caller can tell the
 * two apart.
 */
export function waitForRenderIdle(
  doc: Document = document,
  timeoutMs = 15_000,
): Promise<{ settled: boolean }> {
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
        const body = doc.querySelector(BODY_SELECTOR);
        // Quiet but incomplete means the document is still loading, or a
        // diagram is between frames; keep waiting for the deadline to decide.
        if (body && pendingDiagrams(body) === 0) finish(true);
        else armQuietTimer();
      }, QUIET_MS);
    }

    deadline = window.setTimeout(() => finish(false), timeoutMs);
    // Observed from the root, not the body: on a CLI launch the document is
    // still being opened and the body element does not exist yet.
    observer.observe(doc.documentElement, { childList: true, subtree: true });
    armQuietTimer();
  });
}
