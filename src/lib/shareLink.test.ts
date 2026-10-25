import { describe, expect, it } from "vitest";
import { decodeDocument } from "@/lib/linkCodec";
import { MAX_DOCUMENT_BYTES } from "@/lib/previewDocument";
import { type FileState, makeFileState } from "@/lib/tabs";
import { canShareLink, shareLinkFor, WEB_VIEWER_URL } from "./shareLink";

function file(overrides: Partial<FileState>): FileState {
  return { ...makeFileState("/notes/readme.md", "view"), content: "# Hi", ...overrides };
}

/** Random 7-bit ASCII, one byte a character, which deflate barely shrinks. */
function incompressible(length: number): string {
  const parts: string[] = [];
  for (let made = 0; made < length; made += 32768) {
    const bytes = crypto.getRandomValues(new Uint8Array(Math.min(32768, length - made)));
    parts.push(String.fromCharCode(...bytes.map((byte) => byte & 0x7f)));
  }
  return parts.join("");
}

async function decodedFrom(link: string | null): Promise<string | null> {
  return decodeDocument(new URL(link ?? "").hash.slice(1));
}

describe("WEB_VIEWER_URL", () => {
  it("is the /view/ page on package.json's homepage", () => {
    const url = new URL(WEB_VIEWER_URL);
    expect(url.origin).toBe(new URL(__HOMEPAGE__).origin);
    expect(url.pathname.endsWith("/view/")).toBe(true);
    expect(url.pathname).not.toContain("//");
  });
});

describe("shareLinkFor", () => {
  it.each([
    ["ASCII", "# Title\n\nSome *text*."],
    ["emoji", "Ship it 🚀"],
    ["Persian", "# سلام دنیا"],
    ["CJK", "# 你好，世界"],
    ["empty", ""],
  ])("carries %s text the viewer decodes back", async (_name, content) => {
    const link = await shareLinkFor(content);
    expect(link?.startsWith(`${WEB_VIEWER_URL}#v1.`)).toBe(true);
    expect(await decodedFrom(link)).toBe(content);
  });

  it("carries a document exactly at the viewer's size cap", async () => {
    const content = "a".repeat(MAX_DOCUMENT_BYTES);
    expect(await decodedFrom(await shareLinkFor(content))).toBe(content);
  });

  it("refuses a document over the cap, however short its link would be", async () => {
    expect(await shareLinkFor("a".repeat(MAX_DOCUMENT_BYTES + 1))).toBeNull();
  });

  // Generous timeout: deflating megabytes is slow on a loaded runner.
  it("refuses a document under the cap whose link would be too long to open", {
    timeout: 30_000,
  }, async () => {
    // Seven random bits a byte deflate to about 7/8, and base64 adds a third:
    // a link about 1.17 times the cap, which is also the URL ceiling (2 MiB).
    expect(await shareLinkFor(incompressible(MAX_DOCUMENT_BYTES))).toBeNull();
  });
});

describe("canShareLink", () => {
  it("accepts a loaded markdown file", () => {
    expect(canShareLink(file({}))).toBe(true);
    expect(canShareLink(file({ path: "/notes/flow.mmd" }))).toBe(true);
  });

  it("accepts an untitled document, whose path is only a title", () => {
    expect(canShareLink(file({ path: "Untitled-1", virtual: true, content: "" }))).toBe(true);
  });

  it.each([
    ["canvas", "/notes/board.canvas"],
    ["notebook", "/notes/analysis.ipynb"],
    ["D2 diagram", "/notes/arch.d2"],
    ["image", "/notes/photo.png"],
  ])("refuses a %s, which the viewer cannot render", (_name, path) => {
    expect(canShareLink(file({ path }))).toBe(false);
  });

  it("refuses a file still loading, and no tab at all", () => {
    expect(canShareLink(file({ content: null }))).toBe(false);
    expect(canShareLink(null)).toBe(false);
    expect(canShareLink(undefined)).toBe(false);
  });
});
