import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DirEntry } from "@/lib/tabs";
import { dragFromTo as dragElementTo, releaseAt } from "@/test/pointerDrag";
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
  { name: "sibling.md", path: "/root/subdir/sibling.md", isDirectory: false, modified: 0 },
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

const row = (path: string) => screen.getByTitle(path);
const rootArea = () => document.querySelector("[data-filetree-root]") as HTMLElement;

const dragFromTo = (fromPath: string, target: Element | null) =>
  dragElementTo(row(fromPath), target);

describe("FileTree pointer drag-and-drop move", () => {
  beforeEach(() => {
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  });

  it("moves a file dropped onto a folder row", () => {
    const { props } = renderTree();
    dragFromTo("/root/post.md", row("/root/subdir"));
    expect(row("/root/subdir").getAttribute("data-drop-target")).toBe("true");
    releaseAt();
    expect(props.onMoveEntry).toHaveBeenCalledWith("/root/post.md", "/root/subdir");
    expect(row("/root/subdir").getAttribute("data-drop-target")).toBeNull();
  });

  it("moves a folder (with its children) dropped onto another folder", () => {
    const { props } = renderTree();
    dragFromTo("/root/subdir", row("/root/other"));
    releaseAt();
    expect(props.onMoveEntry).toHaveBeenCalledWith("/root/subdir", "/root/other");
  });

  it("refuses to drop a folder onto its own descendant", () => {
    const { props } = renderTree();
    dragFromTo("/root/subdir", row("/root/subdir/nested"));
    expect(row("/root/subdir/nested").getAttribute("data-drop-target")).toBeNull();
    expect(document.body.style.cursor).toBe("no-drop");
    releaseAt();
    expect(props.onMoveEntry).not.toHaveBeenCalled();
  });

  it("refuses to drop an entry onto its current parent folder", () => {
    const { props } = renderTree();
    dragFromTo("/root/subdir/deep.md", row("/root/subdir"));
    expect(row("/root/subdir").getAttribute("data-drop-target")).toBeNull();
    releaseAt();
    expect(props.onMoveEntry).not.toHaveBeenCalled();
  });

  it("moves a nested entry dropped on the empty root area to the workspace root", () => {
    const { props } = renderTree();
    dragFromTo("/root/subdir/deep.md", rootArea());
    expect(rootArea().getAttribute("data-drop-target")).toBe("true");
    releaseAt();
    expect(props.onMoveEntry).toHaveBeenCalledWith("/root/subdir/deep.md", "/root");
  });

  it("rejects the root area for a top-level entry (already there)", () => {
    const { props } = renderTree();
    dragFromTo("/root/post.md", rootArea());
    expect(rootArea().getAttribute("data-drop-target")).toBeNull();
    releaseAt();
    expect(props.onMoveEntry).not.toHaveBeenCalled();
  });

  it("does not offer the root zone in the gaps between rows", () => {
    const { props } = renderTree();
    const list = rootArea().querySelector("ul") as HTMLElement;
    dragFromTo("/root/subdir/deep.md", list);
    expect(rootArea().getAttribute("data-drop-target")).toBeNull();
    releaseAt();
    expect(props.onMoveEntry).not.toHaveBeenCalled();
  });

  it("drops onto a file row into that file's containing folder", () => {
    const { props } = renderTree();
    dragFromTo("/root/subdir/deep.md", row("/root/post.md"));
    expect(rootArea().getAttribute("data-drop-target")).toBe("true");
    releaseAt();
    expect(props.onMoveEntry).toHaveBeenCalledWith("/root/subdir/deep.md", "/root");
  });

  it("refuses a drop onto a sibling file in the same folder (no-op)", () => {
    const { props } = renderTree();
    dragFromTo("/root/subdir/deep.md", row("/root/subdir/sibling.md"));
    expect(row("/root/subdir").getAttribute("data-drop-target")).toBeNull();
    expect(document.body.style.cursor).toBe("no-drop");
    releaseAt();
    expect(props.onMoveEntry).not.toHaveBeenCalled();
  });

  it("keeps plain clicks working (open file, toggle folder)", () => {
    const { props } = renderTree();
    fireEvent.pointerDown(row("/root/post.md"), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(window, { clientX: 0, clientY: 0 });
    fireEvent.click(row("/root/post.md"));
    expect(props.onOpenFile).toHaveBeenCalledWith("/root/post.md");
    fireEvent.pointerDown(row("/root/other"), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(window, { clientX: 0, clientY: 0 });
    fireEvent.click(row("/root/other"));
    expect(props.onToggle).toHaveBeenCalledWith("/root/other");
  });

  it("swallows the click synthesized after a completed drag", () => {
    const { props } = renderTree();
    dragFromTo("/root/post.md", row("/root/subdir"));
    releaseAt();
    fireEvent.click(row("/root/post.md"));
    expect(props.onOpenFile).not.toHaveBeenCalled();
    // The suppression is one-shot: the next real click opens as usual.
    fireEvent.pointerDown(row("/root/post.md"), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(window, { clientX: 0, clientY: 0 });
    fireEvent.click(row("/root/post.md"));
    expect(props.onOpenFile).toHaveBeenCalledWith("/root/post.md");
  });

  it("cancels on Escape and leaves the tree untouched", () => {
    const { props } = renderTree();
    dragFromTo("/root/post.md", row("/root/subdir"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(row("/root/subdir").getAttribute("data-drop-target")).toBeNull();
    releaseAt();
    expect(props.onMoveEntry).not.toHaveBeenCalled();
  });
});
