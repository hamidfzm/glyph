import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("renders the heading", () => {
    render(<EmptyState platform="macos" onOpenFile={vi.fn()} />);
    expect(screen.getByText("Open a Markdown file")).toBeInTheDocument();
  });

  it("shows ⌘+O shortcut on macOS", () => {
    render(<EmptyState platform="macos" onOpenFile={vi.fn()} />);
    expect(screen.getByText("⌘+O")).toBeInTheDocument();
  });

  it("shows Ctrl+O shortcut on Windows", () => {
    render(<EmptyState platform="windows" onOpenFile={vi.fn()} />);
    expect(screen.getByText("Ctrl+O")).toBeInTheDocument();
  });

  it("shows Ctrl+O shortcut on Linux", () => {
    render(<EmptyState platform="linux" onOpenFile={vi.fn()} />);
    expect(screen.getByText("Ctrl+O")).toBeInTheDocument();
  });

  it("calls onOpenFile when button is clicked", () => {
    const onOpenFile = vi.fn();
    render(<EmptyState platform="macos" onOpenFile={onOpenFile} />);
    fireEvent.click(screen.getByText("Open File"));
    expect(onOpenFile).toHaveBeenCalledOnce();
  });

  it("renders Open File button with type=button", () => {
    render(<EmptyState platform="macos" onOpenFile={vi.fn()} />);
    const button = screen.getByText("Open File");
    expect(button).toHaveAttribute("type", "button");
  });
});
