import { describe, expect, it } from "vitest";
import { EDITOR_MODE } from "@/lib/settings";
import { makeFileState, type TabsState, updateFiles } from "./tabs";

const state: TabsState = {
  activeTabId: "a",
  tabs: [
    { id: "a", kind: "file", file: makeFileState("/p/a.md", EDITOR_MODE.view) },
    { id: "g", kind: "graph", root: "/p", file: null },
    { id: "b", kind: "file", file: makeFileState("/p/b.md", EDITOR_MODE.view) },
  ],
};

describe("updateFiles", () => {
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
