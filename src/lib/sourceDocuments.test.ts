import { afterEach, describe, expect, it } from "vitest";
import type { Disposer } from "@/lib/plugins/disposer";
import { registerFileType } from "@/lib/plugins/fileTypes";
import { fenceSource, isFencedDocument, isSourceDocument } from "./sourceDocuments";

let dispose: Disposer | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
});

describe("isSourceDocument", () => {
  it("counts .d2 even while no plugin claims it", () => {
    expect(isSourceDocument("/p/arch.d2")).toBe(true);
  });

  it("counts a plugin file type only while it is registered", () => {
    expect(isSourceDocument("/p/seq.puml")).toBe(false);
    dispose = registerFileType({ extensions: ["puml"], language: "plantuml" });
    expect(isSourceDocument("/p/seq.puml")).toBe(true);
  });

  it("leaves markdown alone", () => {
    expect(isSourceDocument("/p/notes.md")).toBe(false);
  });
});

describe("isFencedDocument", () => {
  it.each([
    ["an untitled document", "Untitled-1", false],
    ["an Android content id", "content://com.android.providers.downloads/document/msf%3A12", false],
    ["a markdown note", "/p/notes.md", false],
    ["a notebook's source view", "/p/analysis.ipynb", false],
    ["a canvas", "/p/board.canvas", false],
    ["a .d2 diagram", "/p/arch.d2", true],
    ["a file whose plugin is off", "/p/seq.puml", true],
  ])("%s: %s", (_, path, fenced) => {
    expect(isFencedDocument(path)).toBe(fenced);
  });
});

describe("fenceSource", () => {
  it("fences the body with the language, trimming trailing space", () => {
    expect(fenceSource("x -> y\n\n  ", "d2")).toBe("```d2\nx -> y\n```\n");
  });

  it("shows plain source in an untagged fence", () => {
    expect(fenceSource("x -> y", "")).toBe("```\nx -> y\n```\n");
  });

  it("outruns any backtick run in the body so it cannot close the fence", () => {
    const body = "label: ````code````";
    expect(fenceSource(body, "d2")).toBe(`\`\`\`\`\`d2\n${body}\n\`\`\`\`\`\n`);
  });

  it("handles huge bodies of backtick runs and whitespace without blowing the stack", () => {
    // One argument per run used to go through Math.max, which overflows the
    // call stack past ~65k runs; a long trailing whitespace run was quadratic.
    const runs = "` ".repeat(200_000);
    const spaces = " ".repeat(200_000);
    const started = performance.now();
    expect(fenceSource(runs, "d2").startsWith("```d2\n")).toBe(true);
    expect(fenceSource(`a${spaces}b${spaces}`, "d2")).toContain("a");
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
