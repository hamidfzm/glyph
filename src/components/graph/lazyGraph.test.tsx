import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GraphView } from "./lazyGraph";

// Stub the heavy underlying module so the lazy wrapper resolves to a trivial
// component — the wrapper's job is just code-splitting + Suspense plumbing.
vi.mock("./GraphView", () => ({
  GraphView: (props: { workspaceFiles: readonly string[] }) => (
    <div data-testid="real-graph">{props.workspaceFiles.length}</div>
  ),
}));

describe("lazyGraph", () => {
  it("lazily renders the underlying GraphView once its chunk resolves", async () => {
    render(
      <GraphView workspaceFiles={["/a.md", "/b.md"]} wikilinkRefs={[]} onOpenFile={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByTestId("real-graph")).toBeInTheDocument());
    expect(screen.getByTestId("real-graph")).toHaveTextContent("2");
  });
});
