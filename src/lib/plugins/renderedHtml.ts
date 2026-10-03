/**
 * The active document's rendered body as plugins receive it: app-only UI
 * stripped and images inlined, once rendering has settled. Null when nothing
 * is rendered.
 */
export async function prepareRenderedHtml(): Promise<string | null> {
  // Loaded on first use so the export pipeline stays out of the startup bundle.
  const [{ prepareContent }, { EXPORTABLE_ROOT_SELECTOR, waitForRenderIdle }] = await Promise.all([
    import("@/lib/export/prepareContent"),
    import("@/lib/export/renderReady"),
  ]);
  // With nothing rendered, waiting would stall until the gate's deadline.
  if (document.querySelector(EXPORTABLE_ROOT_SELECTOR)) await waitForRenderIdle();
  const prepared = await prepareContent({ entries: [], includeToc: false });
  return prepared?.html ?? null;
}
