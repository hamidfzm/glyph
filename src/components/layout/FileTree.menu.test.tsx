import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ComponentProps, createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import type { DirEntry } from "@/lib/tabs";
import { FileTree, type FileTreeHandle } from "./FileTree";

const sampleEntries: DirEntry[] = [
  { name: "subdir", path: "/root/subdir", isDirectory: true, modified: 0 },
  { name: "post.md", path: "/root/post.md", isDirectory: false, modified: 0 },
];

function renderFileTree(overrides: Partial<ComponentProps<typeof FileTree>> = {}) {
  const props: ComponentProps<typeof FileTree> = {
    root: "/root",
    nodes: new Map([["/root", sampleEntries]]),
    expanded: new Set(),
    onToggle: vi.fn(),
    onOpenFile: vi.fn(),
    onOpenInNewWindow: vi.fn(),
    onCreateNote: vi.fn(async () => null),
    onCreateCanvas: vi.fn(async () => null),
    onCreateFolder: vi.fn(async () => null),
    onRename: vi.fn(async () => null),
    onDuplicate: vi.fn(async () => null),
    onMove: vi.fn(),
    onReveal: vi.fn(),
    onDelete: vi.fn(async () => true),
    ...overrides,
  };
  const ref = createRef<FileTreeHandle>();
  return { ...render(<FileTree ref={ref} {...props} />), props, ref };
}

describe("FileTree context menu", () => {
  it("opens a file menu with Open and create actions", () => {
    renderFileTree();
    fireEvent.contextMenu(screen.getByText("post.md"));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByText("New Note")).toBeInTheDocument();
    expect(screen.getByText("New Folder")).toBeInTheDocument();
  });

  it("offers Open in new window on file rows only", () => {
    renderFileTree();
    fireEvent.contextMenu(screen.getByText("post.md"));
    expect(screen.getByText("Open in new window")).toBeInTheDocument();
  });

  it("omits Open in new window for folder rows", () => {
    renderFileTree();
    fireEvent.contextMenu(screen.getByText("subdir"));
    expect(screen.queryByText("Open in new window")).not.toBeInTheDocument();
  });

  it("omits Open in new window in the empty area below the tree", () => {
    const { container } = renderFileTree();
    const root = container.querySelector("[data-filetree-root]");
    if (!root) throw new Error("file tree root missing");
    fireEvent.contextMenu(root);
    expect(screen.queryByText("Open in new window")).not.toBeInTheDocument();
  });

  it("calls onOpenInNewWindow with the right-clicked file", () => {
    const { props } = renderFileTree();
    fireEvent.contextMenu(screen.getByText("post.md"));
    fireEvent.click(screen.getByText("Open in new window"));
    expect(props.onOpenInNewWindow).toHaveBeenCalledWith("/root/post.md");
  });

  it("calls onOpenFile when context menu Open is clicked", () => {
    const { props } = renderFileTree();
    fireEvent.contextMenu(screen.getByText("post.md"));
    fireEvent.click(screen.getByText("Open"));
    expect(props.onOpenFile).toHaveBeenCalledWith("/root/post.md");
  });

  it("shows create + delete actions (no Open) when right-clicking a folder row", () => {
    renderFileTree();
    fireEvent.contextMenu(screen.getByText("subdir"));
    expect(screen.getByText("New Note")).toBeInTheDocument();
    expect(screen.getByText("New Folder")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
    expect(screen.queryByText("Open")).toBeNull();
  });

  it("deletes a file via the context menu", () => {
    const { props } = renderFileTree();
    fireEvent.contextMenu(screen.getByText("post.md"));
    fireEvent.click(screen.getByText("Delete"));
    expect(props.onDelete).toHaveBeenCalledWith("/root/post.md");
  });

  it("deletes a folder via the context menu", () => {
    const { props } = renderFileTree();
    fireEvent.contextMenu(screen.getByText("subdir"));
    fireEvent.click(screen.getByText("Delete"));
    expect(props.onDelete).toHaveBeenCalledWith("/root/subdir");
  });

  it("offers no Delete on the empty-area (root) menu", async () => {
    const { container } = renderFileTree();
    fireEvent.contextMenu(container.firstChild as Element);
    expect(await screen.findByText("New Note")).toBeInTheDocument();
    expect(screen.queryByText("Delete")).toBeNull();
  });

  it("renames an existing file via the menu without re-opening it", async () => {
    const onRename = vi.fn(async () => "/root/renamed.md");
    const onOpenFile = vi.fn();
    renderFileTree({ onRename, onOpenFile });

    fireEvent.contextMenu(screen.getByText("post.md"));
    fireEvent.click(screen.getByText("Rename"));
    const input = await screen.findByRole("textbox");
    expect(input).toHaveValue("post");
    fireEvent.change(input, { target: { value: "renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(onRename).toHaveBeenCalledWith("/root/post.md", "renamed"));
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("duplicates an entry via 'Make a copy'", () => {
    const { props } = renderFileTree();
    fireEvent.contextMenu(screen.getByText("post.md"));
    fireEvent.click(screen.getByText("Make a copy"));
    expect(props.onDuplicate).toHaveBeenCalledWith("/root/post.md");
  });

  it("reveals an entry in the system explorer", () => {
    const { props } = renderFileTree();
    fireEvent.contextMenu(screen.getByText("subdir"));
    fireEvent.click(screen.getByText("Show in system explorer"));
    expect(props.onReveal).toHaveBeenCalledWith("/root/subdir");
  });

  it("copies the workspace-relative and absolute paths", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderFileTree();

    fireEvent.contextMenu(screen.getByText("post.md"));
    fireEvent.click(screen.getByText("Copy path"));
    expect(writeText).toHaveBeenCalledWith("post.md");

    fireEvent.contextMenu(screen.getByText("post.md"));
    fireEvent.click(screen.getByText("Copy absolute path"));
    expect(writeText).toHaveBeenCalledWith("/root/post.md");
  });

  it("copies a path that is outside the workspace root as-is", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const loose: DirEntry = { name: "x.md", path: "other/x.md", isDirectory: false, modified: 0 };
    renderFileTree({ nodes: new Map([["/root", [loose]]]) });

    fireEvent.contextMenu(screen.getByText("x.md"));
    fireEvent.click(screen.getByText("Copy path"));
    expect(writeText).toHaveBeenCalledWith("other/x.md");
  });

  it("ignores clipboard rejections when copying a path", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderFileTree();

    fireEvent.contextMenu(screen.getByText("post.md"));
    fireEvent.click(screen.getByText("Copy path"));
    expect(writeText).toHaveBeenCalled();
    await Promise.resolve();
  });

  it("starts an inline rename on a folder via the menu", async () => {
    renderFileTree();
    fireEvent.contextMenu(screen.getByText("subdir"));
    fireEvent.click(screen.getByText("Rename"));
    const input = await screen.findByRole("textbox");
    expect(input).toHaveValue("subdir");
  });

  it("invokes onMove for the 'Move to…' action", () => {
    const { props } = renderFileTree();
    fireEvent.contextMenu(screen.getByText("post.md"));
    fireEvent.click(screen.getByText("Move to…"));
    expect(props.onMove).toHaveBeenCalledWith("/root/post.md");
  });
});
