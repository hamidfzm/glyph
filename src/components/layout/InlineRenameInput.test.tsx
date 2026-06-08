import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InlineRenameInput } from "./InlineRenameInput";

describe("InlineRenameInput", () => {
  it("focuses on mount", () => {
    render(<InlineRenameInput initialValue="Untitled" onCommit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("textbox")).toHaveFocus();
  });

  it("commits the typed value on Enter", () => {
    const onCommit = vi.fn();
    render(<InlineRenameInput initialValue="x" onCommit={onCommit} onCancel={vi.fn()} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "New Name" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("New Name");
  });

  it("commits the current value on blur", () => {
    const onCommit = vi.fn();
    render(<InlineRenameInput initialValue="keep" onCommit={onCommit} onCancel={vi.fn()} />);
    fireEvent.blur(screen.getByRole("textbox"));
    expect(onCommit).toHaveBeenCalledWith("keep");
  });

  it("cancels on Escape without also committing on the ensuing blur", () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(<InlineRenameInput initialValue="x" onCommit={onCommit} onCancel={onCancel} />);
    const input = screen.getByRole("textbox");
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("commits only once across Enter then blur", () => {
    const onCommit = vi.fn();
    render(<InlineRenameInput initialValue="x" onCommit={onCommit} onCancel={vi.fn()} />);
    const input = screen.getByRole("textbox");
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("cancels at most once across repeated Escape presses", () => {
    const onCancel = vi.fn();
    render(<InlineRenameInput initialValue="x" onCommit={vi.fn()} onCancel={onCancel} />);
    const input = screen.getByRole("textbox");
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("ignores other keys", () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(<InlineRenameInput initialValue="x" onCommit={onCommit} onCancel={onCancel} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "a" });
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });
});
