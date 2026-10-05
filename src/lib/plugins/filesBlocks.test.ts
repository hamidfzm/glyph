import { describe, expect, it } from "vitest";
import { filesBlockKey, filesPanelBlocks } from "./filesBlocks";
import type { SidebarPanelEntry } from "./types";

function panel(pluginId: string, id: string, location?: "outline" | "files"): SidebarPanelEntry {
  return { pluginId, id, title: id, location, mount: () => {} };
}

describe("filesBlockKey", () => {
  it("joins the plugin and panel ids, so two plugins can share a panel id", () => {
    expect(filesBlockKey(panel("glyph.core.tags", "tags", "files"))).toBe("glyph.core.tags:tags");
    expect(filesBlockKey(panel("com.x.demo", "tags", "files"))).toBe("com.x.demo:tags");
  });
});

describe("filesPanelBlocks", () => {
  it("keeps only the panels placed in the Files panel", () => {
    const blocks = filesPanelBlocks([
      panel("com.x.a", "outline-default"),
      panel("com.x.a", "outline-explicit", "outline"),
      panel("com.x.a", "block", "files"),
    ]);
    expect(blocks.map((block) => block.id)).toEqual(["block"]);
  });

  // Core plugins load in parallel and re-register when toggled back on.
  it("orders core blocks by the core list, whichever registered first", () => {
    const blocks = filesPanelBlocks([
      panel("glyph.core.backlinks", "backlinks", "files"),
      panel("glyph.core.tags", "tags", "files"),
    ]);
    expect(blocks.map((block) => block.id)).toEqual(["tags", "backlinks"]);
  });

  it("puts other plugins after the core blocks, in registration order", () => {
    const blocks = filesPanelBlocks([
      panel("com.x.second", "b", "files"),
      panel("com.x.first", "a", "files"),
      panel("glyph.core.backlinks", "backlinks", "files"),
    ]);
    expect(blocks.map((block) => block.id)).toEqual(["backlinks", "b", "a"]);
  });
});
