import { DOCUMENT_SCROLLER, PREVIEW_SCROLLER } from "@/lib/scrollToHeading";

// The viewer's own body, not just any `.markdown-body`: AI replies, note
// embeds, and canvas cards render one too. In split view the preview pane is
// the document.
function documentBody(): HTMLElement | null {
  const scroller =
    document.querySelector(PREVIEW_SCROLLER) ?? document.querySelector(DOCUMENT_SCROLLER);
  if (!scroller) return null;
  return scroller.querySelector<HTMLElement>(".markdown-body, .notebook-body");
}

/**
 * The active document's rendered body as plugins receive it: app-only UI
 * stripped and images inlined, once rendering has settled. Null when no
 * document is rendered (an editor-only tab, a canvas, an empty window).
 */
export async function prepareRenderedHtml(): Promise<string | null> {
  const body = documentBody();
  if (!body) return null;
  // Loaded on first use so the export pipeline stays out of the startup bundle.
  const [{ prepareBody }, { waitForRenderIdle }] = await Promise.all([
    import("@/lib/export/prepareContent"),
    import("@/lib/export/renderReady"),
  ]);
  await waitForRenderIdle();
  const prepared = await prepareBody(body, { entries: [], includeToc: false });
  return prepared.html;
}
