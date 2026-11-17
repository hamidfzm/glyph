import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CHUNK_LOAD_TIMEOUT_MS } from "@/test/chunkLoadTimeout";
import { graphOf } from "@/test/fixtures/graph";
import { GraphView } from "./lazyGraph";

// Stub the heavy underlying module so the lazy wrapper resolves to a trivial
// component — the wrapper's job is just code-splitting + Suspense plumbing.
vi.mock("./GraphView", () => ({
  GraphView: (props: { graph: { nodes: unknown[] } }) => (
    <div data-testid="real-graph">{props.graph.nodes.length}</div>
  ),
}));

describe("lazyGraph", { timeout: CHUNK_LOAD_TIMEOUT_MS }, () => {
  it("lazily renders the underlying GraphView once its chunk resolves", async () => {
    render(<GraphView graph={graphOf(["/a.md", "/b.md"])} onOpenFile={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("real-graph")).toBeInTheDocument(), {
      timeout: CHUNK_LOAD_TIMEOUT_MS,
    });
    expect(screen.getByTestId("real-graph")).toHaveTextContent("2");
  });
});
