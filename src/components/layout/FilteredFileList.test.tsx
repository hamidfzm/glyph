import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FilteredFileList } from "./FilteredFileList";

const defaultProps = {
  label: "#work (2)",
  paths: ["/ws/Index.md", "/ws/Notes/Plan.md"],
  workspaceRoot: "/ws",
  onOpen: vi.fn(),
  onClear: vi.fn(),
};

describe("FilteredFileList", () => {
  it("lists the matching files relative to the workspace root", () => {
    render(<FilteredFileList {...defaultProps} />);
    expect(screen.getByText("Index.md")).toBeTruthy();
    expect(screen.getByText("Notes/Plan.md")).toBeTruthy();
  });

  it("heads the list with the filter's label", () => {
    render(<FilteredFileList {...defaultProps} />);
    expect(screen.getByText("#work (2)")).toBeTruthy();
  });

  it("marks the open document in the list", () => {
    render(<FilteredFileList {...defaultProps} activeFilePath="/ws/Index.md" />);
    expect(screen.getByText("Index.md").className).toContain("bg-[var(--color-accent)]");
    expect(screen.getByText("Notes/Plan.md").className).not.toContain("bg-[var(--color-accent)]");
  });

  it("opens a file on click", () => {
    const onOpen = vi.fn();
    render(<FilteredFileList {...defaultProps} onOpen={onOpen} />);
    fireEvent.click(screen.getByText("Index.md"));
    expect(onOpen).toHaveBeenCalledWith("/ws/Index.md");
  });

  it("clears the filter from the header button", () => {
    const onClear = vi.fn();
    render(<FilteredFileList {...defaultProps} onClear={onClear} />);
    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(onClear).toHaveBeenCalled();
  });
});
