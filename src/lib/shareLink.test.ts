import { describe, expect, it } from "vitest";
import { decodeDocument, MAX_LINK_LENGTH } from "@/lib/linkCodec";
import { type FileState, makeFileState } from "@/lib/tabs";
import { canShareLink, shareLinkFor, WEB_VIEWER_URL } from "./shareLink";

function file(overrides: Partial<FileState>): FileState {
  return { ...makeFileState("/notes/readme.md", "view"), content: "# Hi", ...overrides };
}

/** Random Latin-1 text: deflate cannot shrink it, so a modest document makes a long link. */
function incompressible(length: number): string {
  const parts: string[] = [];
  for (let made = 0; made < length; made += 32768) {
    const bytes = crypto.getRandomValues(new Uint8Array(Math.min(32768, length - made)));
    parts.push(String.fromCharCode(...bytes));
  }
  return parts.join("");
}

describe("WEB_VIEWER_URL", () => {
  it("is the viewer page under package.json's homepage", () => {
    expect(WEB_VIEWER_URL).toBe(`${__HOMEPAGE__}/view/`);
  });
});

describe("shareLinkFor", () => {
  it.each([
    ["ASCII", "# Title\n\nSome *text*."],
    ["emoji", "Ship it 🚀"],
    ["Persian", "# سلام دنیا"],
    ["CJK", "# 你好，世界"],
  ])("carries %s text the viewer decodes back", async (_name, content) => {
    const link = await shareLinkFor(content);
    expect(link?.startsWith(`${WEB_VIEWER_URL}#v1.`)).toBe(true);
    const fragment = new URL(link ?? "").hash.slice(1);
    expect(await decodeDocument(fragment)).toBe(content);
  });

  // Generous timeout: deflating megabytes is slow on a loaded runner.
  it("returns null for a document whose link would be too long to open", {
    timeout: 30_000,
  }, async () => {
    // Half of these characters take two UTF-8 bytes, which stay as large
    // deflated, and base64 grows them by a third: about twice the limit.
    expect(await shareLinkFor(incompressible((3 * MAX_LINK_LENGTH) / 4))).toBeNull();
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
