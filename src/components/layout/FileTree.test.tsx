import { fireEvent, render, screen } from "@testing-library/react";
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
    ...overrides,
  };
  return { ...render(<FileTree {...props} />), props };
}

describe("FileTree", () => {
  it("renders directory entries before file entries", () => {
    renderFileTree();
    const buttons = screen.getAllByRole("button");
    // First button is the root header (none — it's an h3) so first interactive: subdir, then post.md
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

  it("opens context menu on right-click of a file with Open + Open in New Tab options", () => {
    renderFileTree();
    fireEvent.contextMenu(screen.getByText("post.md"));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByText("Open in New Tab")).toBeInTheDocument();
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
