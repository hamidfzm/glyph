import { type ComponentProps, lazy, Suspense } from "react";

// The notebook renderer is only needed when a `.ipynb` file is open, so it (and
// its cell/output/ANSI helpers) is code-split into its own async chunk and
// pulled in on demand — keeping it out of the main bundle.
const NotebookViewerLazy = lazy(() =>
  import("./NotebookViewer").then((m) => ({ default: m.NotebookViewer })),
);

const NotebookSourceLazy = lazy(() =>
  import("./NotebookSource").then((m) => ({ default: m.NotebookSource })),
);

const NotebookSplitLazy = lazy(() =>
  import("./NotebookSplit").then((m) => ({ default: m.NotebookSplit })),
);

export function NotebookViewer(props: ComponentProps<typeof NotebookViewerLazy>) {
  return (
    <Suspense fallback={null}>
      <NotebookViewerLazy {...props} />
    </Suspense>
  );
}

export function NotebookSource(props: ComponentProps<typeof NotebookSourceLazy>) {
  return (
    <Suspense fallback={null}>
      <NotebookSourceLazy {...props} />
    </Suspense>
  );
}

export function NotebookSplit(props: ComponentProps<typeof NotebookSplitLazy>) {
  return (
    <Suspense fallback={null}>
      <NotebookSplitLazy {...props} />
    </Suspense>
  );
}
