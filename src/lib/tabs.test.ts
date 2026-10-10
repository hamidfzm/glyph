import { describe, expect, it } from "vitest";
import { liveContentOf, makeFileState } from "./tabs";

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
