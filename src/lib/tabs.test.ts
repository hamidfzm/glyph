import { describe, expect, it } from "vitest";
import { EDITOR_MODE } from "@/lib/settings";
import { liveContentOf, makeFileState, type TabsState, updateFiles } from "./tabs";

describe("liveContentOf", () => {
  it("is the loaded content while the tab has no edit buffer", () => {
    expect(liveContentOf({ ...makeFileState("/p/a.md", "view"), content: "saved" })).toBe("saved");
  });

  it("is the edit buffer once the tab has one", () => {
    const file = { ...makeFileState("/p/a.md", "view"), content: "saved", editContent: "unsaved" };
    expect(liveContentOf(file)).toBe("unsaved");
  });

  it("keeps an emptied buffer: the empty string is content, not absence", () => {
    const file = { ...makeFileState("/p/a.md", "edit"), content: "saved", editContent: "" };
    expect(liveContentOf(file)).toBe("");
  });

  it("is null while the document is still loading", () => {
    expect(liveContentOf(makeFileState("/p/a.md", "view"))).toBeNull();
  });
});

describe("updateFiles", () => {
  const state: TabsState = {
    activeTabId: "a",
    tabs: [
      { id: "a", kind: "file", file: makeFileState("/p/a.md", EDITOR_MODE.view) },
      { id: "g", kind: "graph", root: "/p", file: null },
      { id: "b", kind: "file", file: makeFileState("/p/b.md", EDITOR_MODE.view) },
    ],
  };

  it("replaces the files the update changes and keeps every other tab as it was", () => {
    const next = updateFiles(state, ({ id, file }) =>
      id === "b" ? { ...file, content: "new" } : file,
    );

    expect(next.tabs[2].file?.content).toBe("new");
    expect(next.tabs[0]).toBe(state.tabs[0]);
    expect(next.tabs[1]).toBe(state.tabs[1]);
    expect(next.activeTabId).toBe("a");
  });

  it("hands back the same state when every file comes back as it was", () => {
    expect(updateFiles(state, ({ file }) => file)).toBe(state);
  });

  it("never offers a graph tab to the update", () => {
    const seen: string[] = [];
    updateFiles(state, ({ id, file }) => {
      seen.push(id);
      return file;
    });

    expect(seen).toEqual(["a", "b"]);
  });
});
