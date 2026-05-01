import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { EmptyState } from "./EmptyState";

function renderEmptyState(overrides: Partial<ComponentProps<typeof EmptyState>> = {}) {
  const props: ComponentProps<typeof EmptyState> = {
    platform: "macos",
    onOpenFile: vi.fn(),
    onOpenFolder: vi.fn(),
    ...overrides,
  };
  return { ...render(<EmptyState {...props} />), props };
}

describe("EmptyState", () => {
  it("renders the heading", () => {
    renderEmptyState();
    expect(screen.getByText("Open a Markdown file")).toBeInTheDocument();
  });

  it("shows ⌘+O shortcut on macOS", () => {
    renderEmptyState({ platform: "macos" });
    expect(screen.getByText("⌘+O")).toBeInTheDocument();
  });

  it("shows Ctrl+O shortcut on Windows", () => {
    renderEmptyState({ platform: "windows" });
    expect(screen.getByText("Ctrl+O")).toBeInTheDocument();
  });

  it("shows Ctrl+O shortcut on Linux", () => {
    renderEmptyState({ platform: "linux" });
    expect(screen.getByText("Ctrl+O")).toBeInTheDocument();
  });

  it("calls onOpenFile when Open File button is clicked", () => {
    const { props } = renderEmptyState();
    fireEvent.click(screen.getByText("Open File"));
    expect(props.onOpenFile).toHaveBeenCalledOnce();
  });

  it("calls onOpenFolder when Open Folder button is clicked", () => {
    const { props } = renderEmptyState();
    fireEvent.click(screen.getByText("Open Folder"));
    expect(props.onOpenFolder).toHaveBeenCalledOnce();
  });

  it("renders Open File button with type=button", () => {
    renderEmptyState();
    const button = screen.getByText("Open File");
    expect(button).toHaveAttribute("type", "button");
  });
});
