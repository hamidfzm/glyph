import { type ComponentProps, lazy, Suspense } from "react";

// d3-force plus the canvas renderer only load when a graph tab is actually
// opened — readers who never use the graph shouldn't pay for the chunk.
const GraphViewLazy = lazy(() => import("./GraphView").then((m) => ({ default: m.GraphView })));

export function GraphView(props: ComponentProps<typeof GraphViewLazy>) {
  return (
    <Suspense fallback={null}>
      <GraphViewLazy {...props} />
    </Suspense>
  );
}
