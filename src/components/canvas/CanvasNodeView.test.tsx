import { openUrl } from "@tauri-apps/plugin-opener";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CanvasNode } from "@/lib/canvas/types";
import { CanvasNodeView } from "./CanvasNodeView";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}));

const base = { id: "n", x: 0, y: 0, width: 200, height: 80 };

describe("CanvasNodeView", () => {
  it("renders a text node's markdown heading", () => {
    const node: CanvasNode = { ...base, type: "text", text: "# Hi" };
    render(<CanvasNodeView node={node} />);
    expect(screen.getByRole("heading", { name: "Hi" })).toBeInTheDocument();
  });

  it("renders a text node's plain paragraph text", () => {
    const node: CanvasNode = { ...base, type: "text", text: "hello" };
    render(<CanvasNodeView node={node} />);
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("renders a link node showing its url and opens it on click", () => {
    const node: CanvasNode = { ...base, type: "link", url: "https://glyph.dev" };
    render(<CanvasNodeView node={node} />);
    const url = screen.getByText("https://glyph.dev");
    expect(url).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(openUrl).toHaveBeenCalledWith("https://glyph.dev");
  });

  it("renders an image for an image file node", () => {
    const node: CanvasNode = { ...base, type: "file", file: "diagram.png" };
    render(<CanvasNodeView node={node} canvasPath="/docs/board.canvas" />);
    const img = screen.getByRole("img", { name: "diagram.png" });
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "asset:///docs/diagram.png");
  });

  it("renders a button for a non-image file node and calls onOpenFile on click", () => {
    const onOpenFile = vi.fn();
    const node: CanvasNode = { ...base, type: "file", file: "notes/todo.md" };
    render(<CanvasNodeView node={node} onOpenFile={onOpenFile} />);
    const button = screen.getByRole("button", { name: "todo.md" });
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    expect(onOpenFile).toHaveBeenCalledWith("notes/todo.md");
  });

  it("uses the basename of a nested image path for the alt text", () => {
    const node: CanvasNode = { ...base, type: "file", file: "assets\\sub\\pic.jpeg" };
    render(<CanvasNodeView node={node} />);
    expect(screen.getByRole("img", { name: "pic.jpeg" })).toBeInTheDocument();
  });

  it("does not throw clicking a non-image file node without an onOpenFile handler", () => {
    const node: CanvasNode = { ...base, type: "file", file: "todo.md" };
    render(<CanvasNodeView node={node} />);
    const button = screen.getByRole("button", { name: "todo.md" });
    expect(() => fireEvent.click(button)).not.toThrow();
  });

  it("renders a group node label with a color style when color is set", () => {
    const node: CanvasNode = { ...base, type: "group", label: "Backlog", color: "1" };
    render(<CanvasNodeView node={node} />);
    const label = screen.getByText("Backlog");
    expect(label).toBeInTheDocument();
    expect(label).toHaveStyle({ color: "var(--glyph-canvas-color-1, #fb464c)" });
  });

  it("renders a group node label without a color style when color is unset", () => {
    const node: CanvasNode = { ...base, type: "group", label: "Notes" };
    render(<CanvasNodeView node={node} />);
    const label = screen.getByText("Notes");
    expect(label).toBeInTheDocument();
    expect(label.getAttribute("style")).toBeFalsy();
  });

  it("renders an inert link card when not interactive (no navigation in editor)", () => {
    vi.mocked(openUrl).mockClear();
    const node: CanvasNode = { ...base, type: "link", url: "https://glyph.dev" };
    render(<CanvasNodeView node={node} interactive={false} />);
    const url = screen.getByText("https://glyph.dev");
    expect(url).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    fireEvent.click(url);
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("renders an inert file card when not interactive", () => {
    const onOpenFile = vi.fn();
    const node: CanvasNode = { ...base, type: "file", file: "doc.md" };
    render(<CanvasNodeView node={node} onOpenFile={onOpenFile} interactive={false} />);
    fireEvent.click(screen.getByText("doc.md"));
    expect(onOpenFile).not.toHaveBeenCalled();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
