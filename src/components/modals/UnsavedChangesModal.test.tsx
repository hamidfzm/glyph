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

  it("keeps Tab inside the dialog so the app behind it cannot be edited", () => {
    render(<UnsavedChangesModal {...defaultProps} />);
    const save = screen.getByRole("button", { name: "Save" });
    const cancel = screen.getByRole("button", { name: "Cancel" });

    // Save is last in the strip, so Tab wraps back to the first button.
    fireEvent.keyDown(save, { key: "Tab" });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true });
    expect(save).toHaveFocus();

    // Ordinary typing is left alone.
    fireEvent.keyDown(save, { key: "a" });
    expect(save).toHaveFocus();
  });

  it("returns focus to where it was when the prompt closes", () => {
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();

    const { unmount } = render(<UnsavedChangesModal {...defaultProps} />);
    expect(screen.getByRole("button", { name: "Save" })).toHaveFocus();
    unmount();

    expect(outside).toHaveFocus();
    outside.remove();
  });

  it("cancels on Escape", () => {
    const onChoose = vi.fn();
    render(<UnsavedChangesModal {...defaultProps} onChoose={onChoose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onChoose).toHaveBeenCalledWith("cancel");
  });
});
