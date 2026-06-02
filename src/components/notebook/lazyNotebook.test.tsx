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
describe("lazyNotebook", () => {
  it("lazily renders the NotebookViewer", async () => {
    render(<NotebookViewer content={notebook} {...props} />);
    await waitFor(() => expect(screen.getByText("lazy heading")).toBeInTheDocument(), {
      timeout: 5000,
    });
  });

  it("lazily renders the NotebookSource", async () => {
    const { container } = render(<NotebookSource content={notebook} {...props} />);
    await waitFor(() => expect(container.querySelector("code")).toBeTruthy(), { timeout: 5000 });
  });

  it("lazily renders the NotebookSplit", async () => {
    const { container } = render(<NotebookSplit content={notebook} {...props} />);
    await waitFor(() => expect(container.querySelector(".split-view")).toBeTruthy(), {
      timeout: 5000,
    });
  });
});
