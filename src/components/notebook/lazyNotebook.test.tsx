import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NotebookSource, NotebookSplit, NotebookViewer } from "./lazyNotebook";

const notebook = JSON.stringify({
  nbformat: 4,
  cells: [{ cell_type: "markdown", source: "lazy heading" }],
});

const props = { searchOpen: false as const, onSearchClose: () => {} };

// These thin Suspense wrappers code-split the notebook renderer into its own
// chunk. The dynamic import resolves asynchronously, so each test waits for the
// real component to appear, which exercises both the fallback and resolved paths.
// The first dynamic import can be slow when the full suite runs under machine
// load, so these tests get a longer timeout than the 5s default.
describe("lazyNotebook", () => {
  it("lazily renders the NotebookViewer", { timeout: 15000 }, async () => {
    render(<NotebookViewer content={notebook} {...props} />);
    await waitFor(() => expect(screen.getByText("lazy heading")).toBeInTheDocument(), {
      timeout: 15000,
    });
  });

  it("lazily renders the NotebookSource", { timeout: 15000 }, async () => {
    const { container } = render(<NotebookSource content={notebook} {...props} />);
    await waitFor(() => expect(container.querySelector("code")).toBeTruthy(), { timeout: 15000 });
  });

  it("lazily renders the NotebookSplit", { timeout: 15000 }, async () => {
    const { container } = render(<NotebookSplit content={notebook} {...props} />);
    await waitFor(() => expect(container.querySelector(".split-view")).toBeTruthy(), {
      timeout: 15000,
    });
  });
});
