import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { TREE_DRAG_TYPE } from "@/hooks/useFileTreeDragMove";
import type { DirEntry } from "@/lib/tabs";
import { FileTree } from "./FileTree";

// /root
//   subdir/         (expanded)
//     deep.md
//     nested/
//   other/
//   post.md
const entries: DirEntry[] = [
  { name: "subdir", path: "/root/subdir", isDirectory: true, modified: 0 },
  { name: "other", path: "/root/other", isDirectory: true, modified: 0 },
  { name: "post.md", path: "/root/post.md", isDirectory: false, modified: 0 },
];
const subdirEntries: DirEntry[] = [
  { name: "deep.md", path: "/root/subdir/deep.md", isDirectory: false, modified: 0 },
  { name: "nested", path: "/root/subdir/nested", isDirectory: true, modified: 0 },
];

function renderTree(overrides: Partial<ComponentProps<typeof FileTree>> = {}) {
  const props: ComponentProps<typeof FileTree> = {
    root: "/root",
    nodes: new Map([
      ["/root", entries],
      ["/root/subdir", subdirEntries],
    ]),
    expanded: new Set(["/root/subdir"]),
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
  return { ...render(<FileTree {...props} />), props };
}

const dataTransfer = () => ({
  setData: vi.fn(),
  effectAllowed: "",
  dropEffect: "",
  types: [TREE_DRAG_TYPE],
});
const row = (path: string) => screen.getByTitle(path);
const rootArea = () => document.querySelector("[data-filetree-root]") as HTMLElement;

describe("FileTree drag-and-drop move", () => {
  it("marks file and folder rows draggable", () => {
    renderTree();
    expect(row("/root/post.md").getAttribute("draggable")).toBe("true");
    expect(row("/root/subdir").getAttribute("draggable")).toBe("true");
  });

  it("moves a file dropped onto a folder row", () => {
    const { props } = renderTree();
    const dt = dataTransfer();
    fireEvent.dragStart(row("/root/post.md"), { dataTransfer: dt });
    fireEvent.dragOver(row("/root/subdir"), { dataTransfer: dt });
    fireEvent.drop(row("/root/subdir"), { dataTransfer: dt });
    expect(props.onMoveEntry).toHaveBeenCalledWith("/root/post.md", "/root/subdir");
  });

  it("moves a folder (with its children) dropped onto another folder", () => {
    const { props } = renderTree();
    const dt = dataTransfer();
    fireEvent.dragStart(row("/root/subdir"), { dataTransfer: dt });
    fireEvent.dragOver(row("/root/other"), { dataTransfer: dt });
    fireEvent.drop(row("/root/other"), { dataTransfer: dt });
    expect(props.onMoveEntry).toHaveBeenCalledWith("/root/subdir", "/root/other");
  });

  it("highlights the hovered folder row during a valid drag", () => {
    renderTree();
    const dt = dataTransfer();
    fireEvent.dragStart(row("/root/post.md"), { dataTransfer: dt });
    fireEvent.dragOver(row("/root/subdir"), { dataTransfer: dt });
    expect(row("/root/subdir").getAttribute("data-drop-target")).toBe("true");
    fireEvent.dragEnd(row("/root/post.md"), { dataTransfer: dt });
    expect(row("/root/subdir").getAttribute("data-drop-target")).toBeNull();
  });

  it("refuses to drop a folder onto its own descendant", () => {
    const { props } = renderTree();
    const dt = dataTransfer();
    fireEvent.dragStart(row("/root/subdir"), { dataTransfer: dt });
    fireEvent.dragOver(row("/root/subdir/nested"), { dataTransfer: dt });
    expect(row("/root/subdir/nested").getAttribute("data-drop-target")).toBeNull();
    fireEvent.drop(row("/root/subdir/nested"), { dataTransfer: dt });
    expect(props.onMoveEntry).not.toHaveBeenCalled();
  });

  it("refuses to drop an entry onto its current parent folder", () => {
    const { props } = renderTree();
    const dt = dataTransfer();
    fireEvent.dragStart(row("/root/subdir/deep.md"), { dataTransfer: dt });
    fireEvent.dragOver(row("/root/subdir"), { dataTransfer: dt });
    expect(row("/root/subdir").getAttribute("data-drop-target")).toBeNull();
    fireEvent.drop(row("/root/subdir"), { dataTransfer: dt });
    expect(props.onMoveEntry).not.toHaveBeenCalled();
  });

  it("moves a nested entry dropped on the empty root area to the workspace root", () => {
    const { props } = renderTree();
    const dt = dataTransfer();
    fireEvent.dragStart(row("/root/subdir/deep.md"), { dataTransfer: dt });
    fireEvent.dragOver(rootArea(), { dataTransfer: dt });
    expect(rootArea().getAttribute("data-drop-target")).toBe("true");
    fireEvent.drop(rootArea(), { dataTransfer: dt });
    expect(props.onMoveEntry).toHaveBeenCalledWith("/root/subdir/deep.md", "/root");
  });

  it("rejects the root area for a top-level entry (already there)", () => {
    const { props } = renderTree();
    const dt = dataTransfer();
    fireEvent.dragStart(row("/root/post.md"), { dataTransfer: dt });
    fireEvent.dragOver(rootArea(), { dataTransfer: dt });
    expect(rootArea().getAttribute("data-drop-target")).toBeNull();
    fireEvent.drop(rootArea(), { dataTransfer: dt });
    expect(props.onMoveEntry).not.toHaveBeenCalled();
  });

  it("does not offer the root zone in the gaps between rows", () => {
    const { props } = renderTree();
    const dt = dataTransfer();
    fireEvent.dragStart(row("/root/subdir/deep.md"), { dataTransfer: dt });
    // Gaps hit-test the list, not the container; the root guard ignores them.
    const list = rootArea().querySelector("ul") as HTMLElement;
    fireEvent.dragOver(list, { dataTransfer: dt });
    expect(rootArea().getAttribute("data-drop-target")).toBeNull();
    fireEvent.drop(list, { dataTransfer: dt });
    expect(props.onMoveEntry).not.toHaveBeenCalled();
  });

  it("ignores a foreign drag without the tree payload type", () => {
    const { props } = renderTree();
    const foreign = { setData: vi.fn(), effectAllowed: "", dropEffect: "", types: ["text/plain"] };
    fireEvent.dragOver(row("/root/subdir"), { dataTransfer: foreign });
    expect(row("/root/subdir").getAttribute("data-drop-target")).toBeNull();
    fireEvent.drop(row("/root/subdir"), { dataTransfer: foreign });
    expect(props.onMoveEntry).not.toHaveBeenCalled();
  });

  it("does not light up the root area while hovering a file row", () => {
    renderTree();
    const dt = dataTransfer();
    fireEvent.dragStart(row("/root/subdir/deep.md"), { dataTransfer: dt });
    // File rows swallow dragover, so the bubbling never reaches the root zone.
    fireEvent.dragOver(row("/root/post.md"), { dataTransfer: dt });
    expect(rootArea().getAttribute("data-drop-target")).toBeNull();
  });

  it("clears the highlight when the drag leaves the hovered folder", () => {
    renderTree();
    const dt = dataTransfer();
    fireEvent.dragStart(row("/root/post.md"), { dataTransfer: dt });
    fireEvent.dragOver(row("/root/subdir"), { dataTransfer: dt });
    fireEvent.dragLeave(row("/root/subdir"), { dataTransfer: dt });
    expect(row("/root/subdir").getAttribute("data-drop-target")).toBeNull();
  });
});
