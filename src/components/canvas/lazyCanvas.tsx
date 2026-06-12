import { type ComponentProps, lazy, Suspense } from "react";

// The canvas renderer (stage, nodes, edges, and the markdown it embeds) is only
// needed when a `.canvas` file is open, so it's code-split into its own async
// chunk and pulled in on demand — keeping it out of the main bundle.
const CanvasViewerLazy = lazy(() =>
  import("./CanvasViewer").then((m) => ({ default: m.CanvasViewer })),
);

const CanvasEditorLazy = lazy(() =>
  import("./CanvasEditor").then((m) => ({ default: m.CanvasEditor })),
);

export function CanvasViewer(props: ComponentProps<typeof CanvasViewerLazy>) {
  return (
    <Suspense fallback={null}>
      <CanvasViewerLazy {...props} />
    </Suspense>
  );
}

export function CanvasEditor(props: ComponentProps<typeof CanvasEditorLazy>) {
  return (
    <Suspense fallback={null}>
      <CanvasEditorLazy {...props} />
    </Suspense>
  );
}
