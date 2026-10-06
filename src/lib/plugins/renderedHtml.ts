import { documentBody } from "@/lib/documentBody";

/**
 * The active document's rendered body as plugins receive it: app-only UI
 * stripped and images inlined, once rendering has settled. Null when no
 * document is rendered (an editor-only tab, a canvas, an empty window).
 */
export async function prepareRenderedHtml(): Promise<string | null> {
  // With no document there is nothing to wait for, only the gate's deadline.
  if (!documentBody()) return null;
  // Loaded on first use so the export pipeline stays out of the startup bundle.
  const [{ prepareContent }, { waitForRenderIdle }] = await Promise.all([
    import("@/lib/export/prepareContent"),
    import("@/lib/export/renderReady"),
  ]);
  await waitForRenderIdle();
  // prepareContent picks the body now, after the wait: a tab switched or
  // closed meanwhile is not returned as the active document.
  const prepared = await prepareContent({ entries: [], includeToc: false });
  return prepared?.html ?? null;
}
