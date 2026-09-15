import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RelinkConfirmModal } from "./RelinkConfirmModal";

const defaultProps = {
  request: {
    root: "/p/ws",
    files: [
      { path: "/p/ws/Index.md", links: 1 },
      { path: "/p/ws/notes/Plan.md", links: 3 },
    ],
    unsaved: ["/p/ws/notes/Plan.md"],
  },
  onChoose: vi.fn(),
};

describe("RelinkConfirmModal", () => {
  it("lists every affected file under the workspace with its link count", () => {
    render(<RelinkConfirmModal {...defaultProps} />);
    expect(screen.getByText("Index.md")).toBeInTheDocument();
    expect(screen.getByText("notes/Plan.md")).toBeInTheDocument();
    expect(screen.getByText("1 link")).toBeInTheDocument();
    expect(screen.getByText("3 links")).toBeInTheDocument();
  });

  it("marks only the files whose unsaved changes are saved first", () => {
    render(<RelinkConfirmModal {...defaultProps} />);
    expect(screen.getAllByText("Unsaved changes will be saved first")).toHaveLength(1);
  });

  it.each([
    ["Update Links", true],
    ["Cancel", false],
  ])("reports %s as %s", (label, confirmed) => {
    const onChoose = vi.fn();
    render(<RelinkConfirmModal {...defaultProps} onChoose={onChoose} />);
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(onChoose).toHaveBeenCalledWith(confirmed);
  });

  it("focuses Update Links", () => {
    render(<RelinkConfirmModal {...defaultProps} />);
    expect(screen.getByRole("button", { name: "Update Links" })).toHaveFocus();
  });

  it("cancels on Escape", () => {
    const onChoose = vi.fn();
    render(<RelinkConfirmModal {...defaultProps} onChoose={onChoose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onChoose).toHaveBeenCalledWith(false);
  });
});
