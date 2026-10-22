import { describe, expect, it } from "vitest";
import { autoSaveDocuments } from "@/lib/autoSaveDocuments";
import { type FileState, makeFileState, type Tab } from "@/lib/tabs";

function fileTab(id: string, over: Partial<FileState>): Tab {
  return { id, kind: "file", file: { ...makeFileState(`/p/${id}.md`, "edit"), ...over } };
}

describe("autoSaveDocuments", () => {
  it("lists every dirty file tab with its revision, active or not", () => {
    const tabs = [
      fileTab("a", { dirty: true, revision: 3 }),
      fileTab("b", { dirty: true, revision: 1 }),
    ];

    expect(autoSaveDocuments(tabs)).toEqual([
      { id: "a", revision: 3 },
      { id: "b", revision: 1 },
    ]);
  });

  it("leaves out clean tabs and graph tabs", () => {
    const tabs: Tab[] = [
      fileTab("clean", { dirty: false, revision: 2 }),
      { id: "graph", kind: "graph", root: "/p", file: null },
    ];

    expect(autoSaveDocuments(tabs)).toEqual([]);
  });

  it("leaves out an untitled document, which is saved only on Save or close", () => {
    const tabs = [
      fileTab("untitled", { path: "Untitled-1", virtual: true, dirty: true, revision: 4 }),
      fileTab("named", { dirty: true, revision: 2 }),
    ];

    expect(autoSaveDocuments(tabs)).toEqual([{ id: "named", revision: 2 }]);
  });

  it("lists a once-untitled document after Save As gave it a path", () => {
    const tabs = [
      fileTab("saved", { path: "/p/saved.md", virtual: false, dirty: true, revision: 5 }),
    ];

    expect(autoSaveDocuments(tabs)).toEqual([{ id: "saved", revision: 5 }]);
  });
});
