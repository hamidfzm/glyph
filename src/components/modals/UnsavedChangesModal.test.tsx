import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UnsavedChangesModal } from "./UnsavedChangesModal";

const defaultProps = {
  files: ["/p/a.md", "/p/nested/b.md"],
  onChoose: vi.fn(),
};

describe("UnsavedChangesModal", () => {
  it("names every affected file by its base name", () => {
    render(<UnsavedChangesModal {...defaultProps} />);
    expect(screen.getByText("a.md")).toBeInTheDocument();
    expect(screen.getByText("b.md")).toBeInTheDocument();
  });

  it.each([
    ["Save", "save"],
    ["Don't Save", "discard"],
    ["Cancel", "cancel"],
  ])("reports %s as %s", (label, choice) => {
    const onChoose = vi.fn();
    render(<UnsavedChangesModal {...defaultProps} onChoose={onChoose} />);
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(onChoose).toHaveBeenCalledWith(choice);
  });

  it("focuses Save so Enter takes the safe option", () => {
    render(<UnsavedChangesModal {...defaultProps} />);
    expect(screen.getByRole("button", { name: "Save" })).toHaveFocus();
  });

  it("cancels on Escape", () => {
    const onChoose = vi.fn();
    render(<UnsavedChangesModal {...defaultProps} onChoose={onChoose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onChoose).toHaveBeenCalledWith("cancel");
  });
});
