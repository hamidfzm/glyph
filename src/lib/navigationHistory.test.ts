import { describe, expect, it } from "vitest";
import { EDITOR_MODE } from "@/lib/settings";
import { makeFileState } from "@/lib/tabs";
import {
  emptyHistory,
  locationOf,
  MAX_HISTORY,
  type NavigationHistory,
  type NavigationLocation,
  pushLocation,
  repointPaths,
  stepBack,
  stepForward,
} from "./navigationHistory";

const note = (path: string, heading?: string): NavigationLocation => ({
  kind: "file",
  path,
  heading,
});

function build(...locations: NavigationLocation[]): NavigationHistory {
  return locations.reduce((h, l) => pushLocation(h, l), emptyHistory());
}

describe("pushLocation", () => {
  it("appends a new location and points at it", () => {
    const h = build(note("/a.md"), note("/b.md"));
    expect(h.entries.map((e) => e.path)).toEqual(["/a.md", "/b.md"]);
    expect(h.index).toBe(1);
  });

  it("changes nothing when the location is already current", () => {
    const h = build(note("/a.md"));
    expect(pushLocation(h, note("/a.md"), 40)).toEqual(h);
  });

  it("treats a different heading on the same file as a new location", () => {
    const h = build(note("/a.md"), note("/a.md", "intro"));
    expect(h.entries).toHaveLength(2);
    expect(pushLocation(h, note("/a.md", "intro"))).toEqual(h);
  });

  it("stamps where the current entry was left when told", () => {
    const h = pushLocation(build(note("/a.md")), note("/a.md", "intro"), 320);
    expect(h.entries[0].scrollTop).toBe(320);
    expect(h.entries[1].scrollTop).toBe(0);
  });

  it("keeps the current entry's stamp when the leaving position is unknown", () => {
    const stamped = pushLocation(build(note("/a.md")), note("/a.md", "intro"), 320);
    const h = pushLocation(stepBack(stamped, 0)!, note("/b.md"));
    expect(h.entries[0].scrollTop).toBe(320);
  });

  it("drops forward entries after going back", () => {
    const back = stepBack(build(note("/a.md"), note("/b.md"), note("/c.md")), 0)!;
    const h = pushLocation(back, note("/d.md"));
    expect(h.entries.map((e) => e.path)).toEqual(["/a.md", "/b.md", "/d.md"]);
    expect(h.index).toBe(2);
  });

  it("caps the stack, dropping the oldest first", () => {
    const many = Array.from({ length: MAX_HISTORY + 5 }, (_, i) => note(`/${i}.md`));
    const h = build(...many);
    expect(h.entries).toHaveLength(MAX_HISTORY);
    expect(h.entries[0].path).toBe("/5.md");
    expect(h.index).toBe(MAX_HISTORY - 1);
  });

  it("records graph entries by workspace root", () => {
    const h = build({ kind: "graph", path: "/ws" });
    expect(h.entries[0]).toEqual({ kind: "graph", path: "/ws", heading: undefined, scrollTop: 0 });
  });
});

describe("stepBack / stepForward", () => {
  it("moves the cursor without changing the entries", () => {
    const h = build(note("/a.md"), note("/b.md"));
    const back = stepBack(h, 0)!;
    expect(back.index).toBe(0);
    expect(back.entries.map((e) => e.path)).toEqual(["/a.md", "/b.md"]);
    expect(stepForward(back, 0)!.index).toBe(1);
  });

  it("stamps the entry being left", () => {
    const h = build(note("/a.md"), note("/b.md"));
    const back = stepBack(h, 150)!;
    expect(back.entries[1].scrollTop).toBe(150);
    const forward = stepForward(back, 75)!;
    expect(forward.entries[0].scrollTop).toBe(75);
  });

  it("returns null at either end and on an empty history", () => {
    const h = build(note("/a.md"), note("/b.md"));
    expect(stepForward(h, 0)).toBeNull();
    expect(stepBack(stepBack(h, 0)!, 0)).toBeNull();
    expect(stepBack(emptyHistory(), 0)).toBeNull();
    expect(stepForward(emptyHistory(), 0)).toBeNull();
  });
});

describe("repointPaths", () => {
  it("moves file entries at or under the old path and leaves the rest", () => {
    const h = build(note("/ws/a.md"), note("/ws/dir/b.md", "h1"), note("/other.md"), {
      kind: "graph",
      path: "/ws",
    });
    const moved = repointPaths(h, "/ws/dir", "/ws/renamed");
    expect(moved.entries.map((e) => e.path)).toEqual([
      "/ws/a.md",
      "/ws/renamed/b.md",
      "/other.md",
      "/ws",
    ]);
    expect(moved.entries[1].heading).toBe("h1");
    expect(moved.index).toBe(h.index);
  });

  it("renames a single file entry", () => {
    const h = build(note("/ws/a.md"), note("/ws/b.md"));
    const moved = repointPaths(h, "/ws/a.md", "/ws/c.md");
    expect(moved.entries.map((e) => e.path)).toEqual(["/ws/c.md", "/ws/b.md"]);
  });
});

describe("locationOf", () => {
  it("maps file and graph tabs to their path", () => {
    const file = { id: "a", kind: "file" as const, file: makeFileState("/a.md", EDITOR_MODE.view) };
    expect(locationOf(file)).toEqual({ kind: "file", path: "/a.md" });
    expect(locationOf({ id: "g", kind: "graph", root: "/ws", file: null })).toEqual({
      kind: "graph",
      path: "/ws",
    });
  });

  it("has no location for an unsaved buffer", () => {
    const untitled = {
      id: "u",
      kind: "file" as const,
      file: { ...makeFileState("Untitled-1", EDITOR_MODE.edit), virtual: true },
    };
    expect(locationOf(untitled)).toBeNull();
  });
});
