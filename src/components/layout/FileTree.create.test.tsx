import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

/** The FileTree root container (used to simulate empty-area right-clicks). */
function container_root(): Element {
  return document.querySelector("[data-filetree-root]") as Element;
}

describe("FileTree creating and inline rename", () => {
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
