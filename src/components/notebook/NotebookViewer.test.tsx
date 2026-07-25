import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NotebookViewer } from "./NotebookViewer";

function notebook(cells: unknown[], metadata?: unknown): string {
  return JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata, cells });
}

const viewerProps = {
  searchOpen: false,
  onSearchClose: () => {},
};

describe("NotebookViewer", () => {
  it("renders a markdown cell's content", () => {
    const content = notebook([{ cell_type: "markdown", source: "# Hello\n\nbody text" }]);
    render(<NotebookViewer content={content} {...viewerProps} />);
    expect(screen.getByRole("heading", { name: "Hello" })).toBeInTheDocument();
    expect(screen.getByText("body text")).toBeInTheDocument();
  });

  it("shows In/Out prompts for a code cell with output", () => {
    const content = notebook([
      {
        cell_type: "code",
        execution_count: 5,
        source: "1 + 1",
        outputs: [
          { output_type: "execute_result", execution_count: 5, data: { "text/plain": "2" } },
        ],
      },
    ]);
    const { container } = render(<NotebookViewer content={content} {...viewerProps} />);
    expect(container.querySelector(".nb-prompt-in")?.textContent).toBe("In [5]:");
    expect(container.querySelector(".nb-prompt-out")?.textContent).toBe("Out [5]:");
  });

  it("renders a raw cell verbatim", () => {
    const content = notebook([{ cell_type: "raw", source: "raw <not> parsed" }]);
    const { container } = render(<NotebookViewer content={content} {...viewerProps} />);
    const raw = container.querySelector(".nb-raw");
    expect(raw?.textContent).toBe("raw <not> parsed");
  });

  it("renders an empty-state message when there are no cells", () => {
    render(<NotebookViewer content={notebook([])} {...viewerProps} />);
    expect(screen.getByText(/no cells/i)).toBeInTheDocument();
  });

  it("renders an error state for invalid notebook JSON", () => {
    render(<NotebookViewer content="{not valid" {...viewerProps} />);
    expect(screen.getByText(/couldn't render this notebook/i)).toBeInTheDocument();
  });

  it("colourises ANSI in stream output", () => {
    const content = notebook([
      {
        cell_type: "code",
        source: "print('x')",
        outputs: [{ output_type: "stream", name: "stdout", text: "\x1b[32mgreen\x1b[0m" }],
      },
    ]);
    const { container } = render(<NotebookViewer content={content} {...viewerProps} />);
    expect(container.querySelector(".ansi-fg-green")?.textContent).toBe("green");
  });

  it("renders a code cell with mixed outputs and a cleared execution count", () => {
    // Exercises the output-keyer's stream/error/data arms in one cell, plus the
    // `In [ ]:` prompt when execution_count is null.
    const content = notebook([
      {
        cell_type: "code",
        execution_count: null,
        source: "work()",
        outputs: [
          { output_type: "stream", name: "stdout", text: "log\n" },
          { output_type: "error", ename: "E", evalue: "v", traceback: ["E: v"] },
          { output_type: "execute_result", data: { "text/plain": "result" } },
        ],
      },
    ]);
    const { container } = render(<NotebookViewer content={content} {...viewerProps} />);
    expect(container.querySelector(".nb-prompt-in")?.textContent).toBe("In [ ]:");
    expect(container.querySelectorAll(".nb-output-row").length).toBe(3);
  });

  it("restores the initial scroll position on mount", () => {
    const raf = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      });
    const { container } = render(
      <NotebookViewer
        content={notebook([{ cell_type: "markdown", source: "x" }])}
        initialScrollTop={120}
        {...viewerProps}
      />,
    );
    const scroller = container.querySelector(".overflow-y-auto") as HTMLElement;
    expect(scroller.scrollTop).toBe(120);
    raf.mockRestore();
  });

  it("reports scroll position changes to onScrollChange", () => {
    const onScrollChange = vi.fn();
    const { container } = render(
      <NotebookViewer
        content={notebook([{ cell_type: "markdown", source: "x" }])}
        onScrollChange={onScrollChange}
        {...viewerProps}
      />,
    );
    const scroller = container.querySelector(".overflow-y-auto") as HTMLElement;
    Object.defineProperty(scroller, "scrollTop", { value: 42, configurable: true });
    fireEvent.scroll(scroller);
    expect(onScrollChange).toHaveBeenCalledWith(42);
  });

  it("renders the search bar when searchOpen and closes it", () => {
    const onSearchClose = vi.fn();
    render(
      <NotebookViewer
        content={notebook([{ cell_type: "markdown", source: "findme" }])}
        searchOpen
        onSearchClose={onSearchClose}
      />,
    );
    const closeBtn = screen.getByRole("button", { name: /close/i });
    act(() => {
      closeBtn.click();
    });
    expect(onSearchClose).toHaveBeenCalled();
  });
});
