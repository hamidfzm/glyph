import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NotebookSplit } from "./NotebookSplit";

function notebook(cells: unknown[]): string {
  return JSON.stringify({ nbformat: 4, nbformat_minor: 5, cells });
}

const props = { searchOpen: false, onSearchClose: () => {} };

describe("NotebookSplit", () => {
  it("renders both the JSON source pane and the rendered cell pane", () => {
    const content = notebook([{ cell_type: "markdown", source: "# Heading" }]);
    const { container } = render(<NotebookSplit content={content} {...props} />);

    // Source pane: raw JSON in a code block.
    const code = container.querySelector(".split-view-editor code");
    expect(code?.textContent).toContain('"cell_type"');

    // Rendered pane: the markdown heading.
    const heading = container.querySelector(".split-view-preview h1");
    expect(heading?.textContent).toBe("Heading");
  });

  it("labels the source pane and does not show an editable field", () => {
    const { container } = render(<NotebookSplit content={notebook([])} {...props} />);
    expect(screen.getByText("Source (read-only)")).toBeInTheDocument();
    expect(container.querySelector("textarea")).toBeNull();
  });
});
