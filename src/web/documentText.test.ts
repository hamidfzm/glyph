import { describe, expect, it, vi } from "vitest";
import { decodeUtf8, MAX_DOCUMENT_BYTES, readDocumentFile } from "./documentText";

describe("decodeUtf8", () => {
  it("decodes UTF-8 and drops a leading BOM", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("# Hi")]);
    expect(decodeUtf8(bytes)).toBe("# Hi");
  });

  it("returns null for bytes that are not UTF-8", () => {
    expect(decodeUtf8(new Uint8Array([0x48, 0xff, 0xfe]))).toBeNull();
  });

  it("keeps an empty document distinct from an unreadable one", () => {
    expect(decodeUtf8(new Uint8Array())).toBe("");
  });
});

describe("readDocumentFile", () => {
  it("reads a markdown file as a document with no folder", async () => {
    const file = new File(["# Hi"], "notes.md");
    expect(await readDocumentFile(file)).toEqual({
      kind: "document",
      content: "# Hi",
      baseUrl: null,
    });
  });

  it("reports a file over the cap without reading it", async () => {
    const file = new File(["x"], "big.md");
    Object.defineProperty(file, "size", { value: MAX_DOCUMENT_BYTES + 1 });
    const read = vi.spyOn(file, "arrayBuffer");
    expect(await readDocumentFile(file)).toEqual({
      kind: "tooLarge",
      bytes: MAX_DOCUMENT_BYTES + 1,
    });
    expect(read).not.toHaveBeenCalled();
  });

  it("reports a file that is not UTF-8 as unreadable", async () => {
    const file = new File([new Uint8Array([0xff, 0xfe, 0x00])], "binary.md");
    expect(await readDocumentFile(file)).toEqual({ kind: "unreadable" });
  });

  it("reports a file whose read fails, such as a dropped folder, as unreadable", async () => {
    const file = new File([], "folder");
    vi.spyOn(file, "arrayBuffer").mockRejectedValue(new Error("NotReadableError"));
    expect(await readDocumentFile(file)).toEqual({ kind: "unreadable" });
  });

  it("reports a Mermaid source the fence pushes past the cap as too large", async () => {
    const source = "graph TD\n  A --> B\n%% ";
    const file = new File([source + "x".repeat(MAX_DOCUMENT_BYTES - source.length)], "big.mmd");
    expect(file.size).toBe(MAX_DOCUMENT_BYTES);
    expect(await readDocumentFile(file)).toMatchObject({ kind: "tooLarge" });
  });

  it("fences a Mermaid .mmd source so it renders as a diagram", async () => {
    const file = new File(["graph TD\n  A --> B\n"], "flow.mmd");
    const message = await readDocumentFile(file);
    expect(message).toMatchObject({ kind: "document" });
    expect(message.kind === "document" && message.content.startsWith("```mermaid")).toBe(true);
  });
});
