import { afterEach, describe, expect, it } from "vitest";
import type { Disposer } from "@/lib/plugins/disposer";
import { registerFileType } from "@/lib/plugins/fileTypes";
import { isSourceDocument, sourceDocumentMarkdown } from "./sourceDocuments";

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

describe("sourceDocumentMarkdown", () => {
  it("fences the body with the registered language, trimming trailing space", () => {
    dispose = registerFileType({ extensions: ["d2"], language: "d2" });
    expect(sourceDocumentMarkdown("/p/a.d2", "x -> y\n\n  ")).toBe("```d2\nx -> y\n```\n");
  });

  it("shows plain source in an untagged fence when no plugin claims the extension", () => {
    expect(sourceDocumentMarkdown("/p/a.d2", "x -> y")).toBe("```\nx -> y\n```\n");
  });

  it("outruns any backtick run in the body so it cannot close the fence", () => {
    const body = "label: ````code````";
    expect(sourceDocumentMarkdown("/p/a.d2", body)).toBe(`\`\`\`\`\`\n${body}\n\`\`\`\`\`\n`);
  });
});
