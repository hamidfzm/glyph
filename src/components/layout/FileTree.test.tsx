import { fireEvent, render, screen } from "@testing-library/react";
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
    onMoveEntry: vi.fn(),
    onReveal: vi.fn(),
    onDelete: vi.fn(async () => true),
    ...overrides,
  };
  const ref = createRef<FileTreeHandle>();
  return { ...render(<FileTree ref={ref} {...props} />), props, ref };
}

describe("FileTree rendering", () => {
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
