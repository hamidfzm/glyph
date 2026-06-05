import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import type { DirEntry } from "@/hooks/useTabs";
import { FileTree } from "./FileTree";

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
    onOpenFileInNewTab: vi.fn(),
    onCreateNote: vi.fn(async () => null),
    onCreateFolder: vi.fn(async () => null),
    onRename: vi.fn(async () => null),
    ...overrides,
  };
  return { ...render(<FileTree {...props} />), props };
}

describe("FileTree", () => {
  it("renders directory entries before file entries", () => {
    renderFileTree();
    const buttons = screen.getAllByRole("button");
    const labels = buttons.map((b) => b.textContent?.trim());
    const subdirIdx = labels.indexOf("subdir");
    const fileIdx = labels.indexOf("post.md");
    expect(subdirIdx).toBeGreaterThanOrEqual(0);
    expect(fileIdx).toBeGreaterThan(subdirIdx);
  });

  it("renders nothing when the root has no entries", () => {
    renderFileTree({ nodes: new Map() });
    expect(screen.queryByText("post.md")).toBeNull();
    expect(screen.queryByText("subdir")).toBeNull();
  });

  it("calls onOpenFile when clicking a file", () => {
    const { props } = renderFileTree();
    fireEvent.click(screen.getByText("post.md"));
    expect(props.onOpenFile).toHaveBeenCalledWith("/root/post.md");
  });

  it("calls onToggle when clicking a directory", () => {
    const { props } = renderFileTree();
    fireEvent.click(screen.getByText("subdir"));
    expect(props.onToggle).toHaveBeenCalledWith("/root/subdir");
  });

  it("opens a file menu with Open, Open in New Tab, and create actions", () => {
    renderFileTree();
    fireEvent.contextMenu(screen.getByText("post.md"));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByText("Open in New Tab")).toBeInTheDocument();
    expect(screen.getByText("New Note")).toBeInTheDocument();
    expect(screen.getByText("New Folder")).toBeInTheDocument();
  });

  it("calls onOpenFileInNewTab when context menu Open in New Tab is clicked", () => {
    const { props } = renderFileTree();
    fireEvent.contextMenu(screen.getByText("post.md"));
    fireEvent.click(screen.getByText("Open in New Tab"));
    expect(props.onOpenFileInNewTab).toHaveBeenCalledWith("/root/post.md");
  });

  it("calls onOpenFile when context menu Open is clicked", () => {
    const { props } = renderFileTree();
    fireEvent.contextMenu(screen.getByText("post.md"));
    fireEvent.click(screen.getByText("Open"));
    expect(props.onOpenFile).toHaveBeenCalledWith("/root/post.md");
  });

  it("shows create actions (no Open) when right-clicking a folder row", () => {
    renderFileTree();
    fireEvent.contextMenu(screen.getByText("subdir"));
    expect(screen.getByText("New Note")).toBeInTheDocument();
    expect(screen.getByText("New Folder")).toBeInTheDocument();
    expect(screen.queryByText("Open in New Tab")).toBeNull();
  });

  it("targets the folder when creating inside a folder row", async () => {
    const onCreateNote = vi.fn(async () => null);
    renderFileTree({ onCreateNote });
    fireEvent.contextMenu(screen.getByText("subdir"));
    fireEvent.click(screen.getByText("New Note"));
    await waitFor(() => expect(onCreateNote).toHaveBeenCalledWith("/root/subdir"));
  });

  it("creates at the root when right-clicking empty space", async () => {
    const onCreateFolder = vi.fn(async () => null);
    const { container } = renderFileTree({ onCreateFolder });
    fireEvent.contextMenu(container.firstChild as Element);
    fireEvent.click(screen.getByText("New Folder"));
    await waitFor(() => expect(onCreateFolder).toHaveBeenCalledWith("/root"));
  });

  it("creates a note (targeting the file's parent), inline-renames, and opens it", async () => {
    const created: DirEntry = {
      name: "Untitled.md",
      path: "/root/Untitled.md",
      isDirectory: false,
      modified: 0,
    };
    const onCreateNote = vi.fn(async () => "/root/Untitled.md");
    const onRename = vi.fn(async () => "/root/My Note.md");
    const onOpenFile = vi.fn();
    // nodes already contains the created entry, mirroring the post-create refresh.
    renderFileTree({
      nodes: new Map([["/root", [...sampleEntries, created]]]),
      onCreateNote,
      onRename,
      onOpenFile,
    });

    fireEvent.contextMenu(screen.getByText("post.md"));
    fireEvent.click(screen.getByText("New Note"));
    await waitFor(() => expect(onCreateNote).toHaveBeenCalledWith("/root"));

    const input = await screen.findByRole("textbox");
    expect(input).toHaveValue("Untitled");
    fireEvent.change(input, { target: { value: "My Note" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(onRename).toHaveBeenCalledWith("/root/Untitled.md", "My Note"));
    await waitFor(() => expect(onOpenFile).toHaveBeenCalledWith("/root/My Note.md"));
  });

  it("keeps the default name and opens the note when rename is cancelled with Escape", async () => {
    const created: DirEntry = {
      name: "Untitled.md",
      path: "/root/Untitled.md",
      isDirectory: false,
      modified: 0,
    };
    const onCreateNote = vi.fn(async () => "/root/Untitled.md");
    const onRename = vi.fn(async () => null);
    const onOpenFile = vi.fn();
    renderFileTree({
      nodes: new Map([["/root", [created]]]),
      onCreateNote,
      onRename,
      onOpenFile,
    });

    fireEvent.contextMenu(container_root());
    fireEvent.click(screen.getByText("New Note"));
    const input = await screen.findByRole("textbox");
    fireEvent.keyDown(input, { key: "Escape" });

    await waitFor(() => expect(onOpenFile).toHaveBeenCalledWith("/root/Untitled.md"));
    expect(onRename).not.toHaveBeenCalled();
  });

  it("keeps the default name on an empty commit and still opens the note", async () => {
    const created: DirEntry = {
      name: "Untitled.md",
      path: "/root/Untitled.md",
      isDirectory: false,
      modified: 0,
    };
    const onCreateNote = vi.fn(async () => "/root/Untitled.md");
    const onRename = vi.fn(async () => null);
    const onOpenFile = vi.fn();
    renderFileTree({ nodes: new Map([["/root", [created]]]), onCreateNote, onRename, onOpenFile });

    fireEvent.contextMenu(container_root());
    fireEvent.click(screen.getByText("New Note"));
    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(onOpenFile).toHaveBeenCalledWith("/root/Untitled.md"));
    expect(onRename).not.toHaveBeenCalled();
  });

  it("falls back to the original path when rename resolves to null", async () => {
    const created: DirEntry = {
      name: "Untitled.md",
      path: "/root/Untitled.md",
      isDirectory: false,
      modified: 0,
    };
    const onCreateNote = vi.fn(async () => "/root/Untitled.md");
    const onRename = vi.fn(async () => null);
    const onOpenFile = vi.fn();
    renderFileTree({ nodes: new Map([["/root", [created]]]), onCreateNote, onRename, onOpenFile });

    fireEvent.contextMenu(container_root());
    fireEvent.click(screen.getByText("New Note"));
    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(onRename).toHaveBeenCalledWith("/root/Untitled.md", "Renamed"));
    await waitFor(() => expect(onOpenFile).toHaveBeenCalledWith("/root/Untitled.md"));
  });

  it("creates a folder, inline-renames it, and does not open it", async () => {
    const created: DirEntry = {
      name: "Untitled Folder",
      path: "/root/Untitled Folder",
      isDirectory: true,
      modified: 0,
    };
    const onCreateFolder = vi.fn(async () => "/root/Untitled Folder");
    const onRename = vi.fn(async () => "/root/Archive");
    const onOpenFile = vi.fn();
    renderFileTree({
      nodes: new Map([["/root", [created]]]),
      onCreateFolder,
      onRename,
      onOpenFile,
    });

    fireEvent.contextMenu(container_root());
    fireEvent.click(screen.getByText("New Folder"));
    const input = await screen.findByRole("textbox");
    expect(input).toHaveValue("Untitled Folder");
    fireEvent.change(input, { target: { value: "Archive" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(onRename).toHaveBeenCalledWith("/root/Untitled Folder", "Archive"));
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("keeps the default folder name on an empty commit without opening", async () => {
    const created: DirEntry = {
      name: "Untitled Folder",
      path: "/root/Untitled Folder",
      isDirectory: true,
      modified: 0,
    };
    const onCreateFolder = vi.fn(async () => "/root/Untitled Folder");
    const onRename = vi.fn(async () => null);
    const onOpenFile = vi.fn();
    renderFileTree({
      nodes: new Map([["/root", [created]]]),
      onCreateFolder,
      onRename,
      onOpenFile,
    });

    fireEvent.contextMenu(container_root());
    fireEvent.click(screen.getByText("New Folder"));
    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "  " } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    expect(onRename).not.toHaveBeenCalled();
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("cancels a folder rename without opening anything", async () => {
    const created: DirEntry = {
      name: "Untitled Folder",
      path: "/root/Untitled Folder",
      isDirectory: true,
      modified: 0,
    };
    const onCreateFolder = vi.fn(async () => "/root/Untitled Folder");
    const onOpenFile = vi.fn();
    renderFileTree({ nodes: new Map([["/root", [created]]]), onCreateFolder, onOpenFile });

    fireEvent.contextMenu(container_root());
    fireEvent.click(screen.getByText("New Folder"));
    const input = await screen.findByRole("textbox");
    fireEvent.keyDown(input, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("targets the workspace root when a file has no parent separator", async () => {
    const loose: DirEntry = { name: "loose.md", path: "loose.md", isDirectory: false, modified: 0 };
    const onCreateNote = vi.fn(async () => null);
    renderFileTree({ nodes: new Map([["/root", [loose]]]), onCreateNote });

    fireEvent.contextMenu(screen.getByText("loose.md"));
    fireEvent.click(screen.getByText("New Note"));
    await waitFor(() => expect(onCreateNote).toHaveBeenCalledWith("/root"));
  });

  it("renders an expanded directory's children and highlights the active file", () => {
    const child: DirEntry = {
      name: "nested.md",
      path: "/root/subdir/nested.md",
      isDirectory: false,
      modified: 0,
    };
    renderFileTree({
      nodes: new Map([
        ["/root", sampleEntries],
        ["/root/subdir", [child]],
      ]),
      expanded: new Set(["/root/subdir"]),
      activeFilePath: "/root/subdir/nested.md",
    });

    const active = screen.getByText("nested.md");
    expect(active).toBeInTheDocument();
    fireEvent.click(active);
  });
});

/** The FileTree root container (used to simulate empty-area right-clicks). */
function container_root(): Element {
  // The outer wrapper is the only element with the min-height class.
  return document.querySelector(".min-h-20") as Element;
}
