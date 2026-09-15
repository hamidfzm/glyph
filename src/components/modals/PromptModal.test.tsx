import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PromptModal } from "./PromptModal";

const defaultProps = {
  title: "Update links",
  message: "These files change:",
  onCancel: vi.fn(),
  actions: (
    <>
      <button type="button">Cancel</button>
      <button type="button" data-autofocus>
        Confirm
      </button>
    </>
  ),
  children: <p>Index.md</p>,
};

describe("PromptModal", () => {
  it("names the dialog by its title and describes it by its message", () => {
    render(<PromptModal {...defaultProps} />);
    const dialog = screen.getByRole("dialog", { name: "Update links" });
    expect(dialog).toHaveAccessibleDescription("These files change:");
    expect(screen.getByText("Index.md")).toBeInTheDocument();
  });

  it("focuses the action marked for autofocus", () => {
    render(<PromptModal {...defaultProps} />);
    expect(screen.getByRole("button", { name: "Confirm" })).toHaveFocus();
  });

  it("keeps Tab inside the dialog so the app behind it cannot be edited", () => {
    render(<PromptModal {...defaultProps} />);
    const confirm = screen.getByRole("button", { name: "Confirm" });
    const cancel = screen.getByRole("button", { name: "Cancel" });

    // Confirm is last in the strip, so Tab wraps back to the first button.
    fireEvent.keyDown(confirm, { key: "Tab" });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true });
    expect(confirm).toHaveFocus();

    // Ordinary typing is left alone.
    fireEvent.keyDown(confirm, { key: "a" });
    expect(confirm).toHaveFocus();
  });

  it("returns focus to where it was when the prompt closes", () => {
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();

    const { unmount } = render(<PromptModal {...defaultProps} />);
    expect(screen.getByRole("button", { name: "Confirm" })).toHaveFocus();
    unmount();

    expect(outside).toHaveFocus();
    outside.remove();
  });

  it("cancels on Escape and on nothing else", () => {
    const onCancel = vi.fn();
    render(<PromptModal {...defaultProps} onCancel={onCancel} />);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
