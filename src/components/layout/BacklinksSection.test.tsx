import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Backlink } from "@/lib/backlinks";
import { BacklinksSection } from "./BacklinksSection";

const root = "/workspace";
const backlinks: Backlink[] = [
  { source: "/workspace/Index.md", line: 4, snippet: "see [[Cooking]]" },
  { source: "/workspace/Notes/Travel.md", line: 12, snippet: "ref to [[Cooking]] here" },
];

const defaultProps = {
  backlinks,
  workspaceRoot: root,
  collapsed: false,
  onToggleCollapsed: vi.fn(),
  onOpen: vi.fn(),
};

describe("BacklinksSection", () => {
  it("keeps the heading and shows an empty message without backlinks", () => {
    render(<BacklinksSection {...defaultProps} backlinks={[]} />);
    expect(screen.getByText("Backlinks")).toBeTruthy();
    expect(screen.getByText("0")).toBeTruthy();
    expect(screen.getByText("No backlinks")).toBeTruthy();
  });

  it("shows the count and one row per backlink", () => {
    render(<BacklinksSection {...defaultProps} />);
    expect(screen.getByText("Backlinks")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("Index.md")).toBeTruthy();
    expect(screen.getByText("Notes/Travel.md")).toBeTruthy();
  });

  it("renders snippets for each entry", () => {
    render(<BacklinksSection {...defaultProps} />);
    expect(screen.getByText("see [[Cooking]]")).toBeTruthy();
    expect(screen.getByText("ref to [[Cooking]] here")).toBeTruthy();
  });

  it("invokes onOpen with source and line on click", () => {
    const onOpen = vi.fn();
    render(<BacklinksSection {...defaultProps} onOpen={onOpen} />);
    fireEvent.click(screen.getByText("Index.md"));
    expect(onOpen).toHaveBeenCalledWith("/workspace/Index.md", 4);
  });

  it("reports a header click instead of collapsing itself", () => {
    const onToggleCollapsed = vi.fn();
    render(<BacklinksSection {...defaultProps} onToggleCollapsed={onToggleCollapsed} />);
    fireEvent.click(screen.getByRole("button", { name: /backlinks/i }));
    expect(onToggleCollapsed).toHaveBeenCalledOnce();
    expect(screen.getByText("Index.md")).toBeTruthy();
  });

  it("hides the rows when collapsed", () => {
    render(<BacklinksSection {...defaultProps} collapsed={true} />);
    expect(screen.queryByText("Index.md")).toBeNull();
  });
});
