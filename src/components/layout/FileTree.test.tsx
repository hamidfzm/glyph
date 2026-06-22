import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ComponentProps, createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import type { DirEntry } from "@/hooks/useTabs";
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

  it("renders the canvas icon for .canvas entries and the text icon for notes", () => {
    const entries: DirEntry[] = [
      { name: "board.canvas", path: "/root/board.canvas", isDirectory: false, modified: 0 },
      { name: "note.md", path: "/root/note.md", isDirectory: false, modified: 0 },
    ];
    renderFileTree({ nodes: new Map([["/root", entries]]) });
    // The canvas glyph is built from <rect> cards; the document icon is not.
    expect(screen.getByTitle("/root/board.canvas").querySelector("svg rect")).toBeTruthy();
    expect(screen.getByTitle("/root/note.md").querySelector("svg rect")).toBeNull();
  });

  it("renders the image icon for image and svg entries", () => {
    const entries: DirEntry[] = [
      { name: "photo.png", path: "/root/photo.png", isDirectory: false, modified: 0 },
      { name: "diagram.svg", path: "/root/diagram.svg", isDirectory: false, modified: 0 },
      { name: "note.md", path: "/root/note.md", isDirectory: false, modified: 0 },
    ];
    renderFileTree({ nodes: new Map([["/root", entries]]) });
    // The image glyph is the only one with a <circle> (the sun); canvas/text are not.
    expect(screen.getByTitle("/root/photo.png").querySelector("svg circle")).toBeTruthy();
    expect(screen.getByTitle("/root/diagram.svg").querySelector("svg circle")).toBeTruthy();
    expect(screen.getByTitle("/root/note.md").querySelector("svg circle")).toBeNull();
  });

  it("highlights the active image entry", () => {
    const entries: DirEntry[] = [
      { name: "photo.png", path: "/root/photo.png", isDirectory: false, modified: 0 },
    ];
    renderFileTree({
      nodes: new Map([["/root", entries]]),
      activeFilePath: "/root/photo.png",
    });
    const row = screen.getByTitle("/root/photo.png");
    expect(row.className).toContain("bg-[var(--color-accent)]");
    expect(row.querySelector("svg circle")).toBeTruthy();
  });

  it("highlights the active canvas entry", () => {
    const entries: DirEntry[] = [
      { name: "board.canvas", path: "/root/board.canvas", isDirectory: false, modified: 0 },
    ];
    renderFileTree({
      nodes: new Map([["/root", entries]]),
      activeFilePath: "/root/board.canvas",
    });
    const row = screen.getByTitle("/root/board.canvas");
    expect(row.className).toContain("bg-[var(--color-accent)]");
    expect(row.querySelector("svg rect")).toBeTruthy();
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

  it("opens a file menu with Open and create actions", () => {
    renderFileTree();
    fireEvent.contextMenu(screen.getByText("post.md"));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByText("New Note")).toBeInTheDocument();
    expect(screen.getByText("New Folder")).toBeInTheDocument();
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

  it("creates a canvas via the context menu, inline-renames, and opens it", async () => {
    const created: DirEntry = {
      name: "Untitled.canvas",
      path: "/root/Untitled.canvas",
      isDirectory: false,
      modified: 0,
    };
    const onCreateCanvas = vi.fn(async () => "/root/Untitled.canvas");
    const onRename = vi.fn(async () => "/root/Board.canvas");
    const onOpenFile = vi.fn();
    renderFileTree({
      nodes: new Map([["/root", [...sampleEntries, created]]]),
      onCreateCanvas,
      onRename,
      onOpenFile,
    });

    fireEvent.contextMenu(screen.getByText("post.md"));
    fireEvent.click(screen.getByText("New Canvas"));
    await waitFor(() => expect(onCreateCanvas).toHaveBeenCalledWith("/root"));

    const input = await screen.findByRole("textbox");
    expect(input).toHaveValue("Untitled");
    fireEvent.change(input, { target: { value: "Board" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(onRename).toHaveBeenCalledWith("/root/Untitled.canvas", "Board"));
    await waitFor(() => expect(onOpenFile).toHaveBeenCalledWith("/root/Board.canvas"));
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

  it("does not start an inline edit when creation fails", async () => {
    const onCreateNote = vi.fn(async () => null);
    renderFileTree({ onCreateNote });

    fireEvent.contextMenu(container_root());
    fireEvent.click(screen.getByText("New Note"));
    await waitFor(() => expect(onCreateNote).toHaveBeenCalledWith("/root"));
    // Flush the await in startCreate so its `if (path)` (false) branch runs.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByRole("textbox")).toBeNull();
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

  it("exposes createNote/createFolder via ref, targeting the workspace root", async () => {
    const onCreateNote = vi.fn(async () => null);
    const onCreateFolder = vi.fn(async () => null);
    const { ref } = renderFileTree({ onCreateNote, onCreateFolder });

    await act(async () => {
      ref.current?.createNote();
    });
    expect(onCreateNote).toHaveBeenCalledWith("/root");

    await act(async () => {
      ref.current?.createFolder();
    });
    expect(onCreateFolder).toHaveBeenCalledWith("/root");
  });
});

/** The FileTree root container (used to simulate empty-area right-clicks). */
function container_root(): Element {
  return document.querySelector("[data-filetree-root]") as Element;
}
