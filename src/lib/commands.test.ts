import { describe, expect, it, vi } from "vitest";
import { type Command, rankCommands } from "./commands";
import { buildMetadataIndex } from "./metadata";

function cmd(over: Partial<Command>): Command {
  return {
    id: over.id ?? over.title ?? "x",
    title: over.title ?? "Untitled",
    section: over.section ?? "Commands",
    run: over.run ?? vi.fn(),
    ...over,
  };
}

describe("rankCommands", () => {
  it("returns commands ordered by section then input order when the query is empty", () => {
    const result = rankCommands("", [
      cmd({ id: "c1", title: "C1", section: "Commands" }),
      cmd({ id: "f1", title: "f1", section: "Files" }),
      cmd({ id: "h1", title: "H1", section: "Headings" }),
      cmd({ id: "f2", title: "f2", section: "Files" }),
    ]);
    expect(result.map((r) => r.command.id)).toEqual(["f1", "f2", "h1", "c1"]);
    expect(result.every((r) => r.matches.length === 0)).toBe(true);
  });

  it("filters out non-matching commands when the query is non-empty", () => {
    const result = rankCommands("file", [
      cmd({ id: "open", title: "Open File" }),
      cmd({ id: "settings", title: "Settings" }),
    ]);
    expect(result.map((r) => r.command.id)).toEqual(["open"]);
  });

  it("ranks tighter matches above looser ones", () => {
    const result = rankCommands("of", [
      cmd({ id: "open-folder", title: "Open Folder" }),
      cmd({ id: "of-letter", title: "Origin of letter" }),
    ]);
    // "Open Folder": prefix + word-start = high score
    // "Origin of letter": consecutive but mid-word
    expect(result[0].command.id).toBe("open-folder");
  });

  it("returns match indices for highlighting", () => {
    const [first] = rankCommands("op", [cmd({ title: "Open Folder" })]);
    expect(first.matches.map((i) => "Open Folder"[i])).toEqual(["O", "p"]);
  });

  it("trims whitespace from the query", () => {
    const result = rankCommands("  file  ", [cmd({ title: "Open File" })]);
    expect(result).toHaveLength(1);
  });

  it("respects the limit parameter", () => {
    const list: Command[] = Array.from({ length: 100 }, (_, i) =>
      cmd({ id: `n${i}`, title: `note ${i}`, section: "Files" }),
    );
    expect(rankCommands("note", list, { limit: 5 })).toHaveLength(5);
    expect(rankCommands("", list, { limit: 7 })).toHaveLength(7);
  });

  it("returns an empty list when no commands are supplied", () => {
    expect(rankCommands("anything", [])).toEqual([]);
    expect(rankCommands("", [])).toEqual([]);
  });

  it("treats a whitespace-only query as empty", () => {
    const result = rankCommands("   ", [
      cmd({ id: "a", title: "A", section: "Commands" }),
      cmd({ id: "b", title: "B", section: "Files" }),
    ]);
    expect(result.map((r) => r.command.id)).toEqual(["b", "a"]);
  });

  describe("metadata queries", () => {
    const metadata = buildMetadataIndex([
      { path: "/ws/spec.md", frontmatter: "---\nstatus: draft\n---\n", tags: ["work"] },
      { path: "/ws/diary.md", frontmatter: null, tags: ["personal"] },
    ]);
    const files = [
      cmd({ id: "spec", title: "spec.md", section: "Files", path: "/ws/spec.md" }),
      cmd({ id: "diary", title: "diary.md", section: "Files", path: "/ws/diary.md" }),
      cmd({ id: "settings", title: "Settings" }),
    ];

    it("keeps only the files matching a tag filter", () => {
      const result = rankCommands("tag:work", files, { metadata });
      expect(result.map((r) => r.command.id)).toEqual(["spec"]);
    });

    it("combines a field filter with fuzzy text", () => {
      expect(rankCommands("status:draft spec", files, { metadata })[0].command.id).toBe("spec");
      expect(rankCommands("status:draft diary", files, { metadata })).toEqual([]);
    });

    it("drops non-file commands from a metadata query", () => {
      const result = rankCommands("tag:personal", files, { metadata });
      expect(result.map((r) => r.command.id)).toEqual(["diary"]);
    });

    it("returns nothing when the index is unavailable", () => {
      expect(rankCommands("tag:work", files)).toEqual([]);
    });
  });
});
