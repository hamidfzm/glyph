import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import type { TocEntry } from "@/hooks/useTableOfContents";
import { buildEpub, type EpubMetadata } from "./epub";

const META: EpubMetadata = {
  title: "My Book",
  author: "Ada",
  language: "en",
  identifier: "1234-5678",
  modified: "2026-06-02T10:00:00Z",
};

const ENTRIES: TocEntry[] = [{ id: "intro", text: "Intro", level: 1 }];

async function loadEpub(bytes: Uint8Array) {
  return JSZip.loadAsync(bytes);
}

describe("buildEpub", () => {
  it("produces a zip whose first entry is the mimetype", async () => {
    const bytes = await buildEpub({
      bodyHtml: "<h1>Intro</h1>",
      css: "",
      entries: ENTRIES,
      metadata: META,
    });
    const zip = await loadEpub(bytes);
    expect(Object.keys(zip.files)[0]).toBe("mimetype");
    expect(await zip.file("mimetype")?.async("string")).toBe("application/epub+zip");
  });

  it("includes the container, package, nav, and chapter documents", async () => {
    const bytes = await buildEpub({
      bodyHtml: "<h1>Intro</h1>",
      css: ".a{}",
      entries: ENTRIES,
      metadata: META,
    });
    const zip = await loadEpub(bytes);
    expect(zip.file("META-INF/container.xml")).toBeTruthy();
    expect(zip.file("OEBPS/content.opf")).toBeTruthy();
    expect(zip.file("OEBPS/nav.xhtml")).toBeTruthy();
    expect(zip.file("OEBPS/style.css")).toBeTruthy();
    expect(zip.file("OEBPS/chapter.xhtml")).toBeTruthy();
  });

  it("writes title, author, identifier, and modified into the package metadata", async () => {
    const bytes = await buildEpub({
      bodyHtml: "<p>x</p>",
      css: "",
      entries: ENTRIES,
      metadata: META,
    });
    const opf = await (await loadEpub(bytes)).file("OEBPS/content.opf")?.async("string");
    expect(opf).toContain("<dc:title>My Book</dc:title>");
    expect(opf).toContain('<dc:creator id="author">Ada</dc:creator>');
    expect(opf).toContain("urn:uuid:1234-5678");
    expect(opf).toContain("2026-06-02T10:00:00Z");
  });

  it("links nav entries to in-chapter anchors", async () => {
    const bytes = await buildEpub({
      bodyHtml: "<h1>Intro</h1>",
      css: "",
      entries: ENTRIES,
      metadata: META,
    });
    const nav = await (await loadEpub(bytes)).file("OEBPS/nav.xhtml")?.async("string");
    expect(nav).toContain('href="chapter.xhtml#intro"');
    expect(nav).toContain("Intro");
  });

  it("emits well-formed XHTML for the chapter (void tags self-closed)", async () => {
    const bytes = await buildEpub({
      bodyHtml: "<p>line<br>break</p><hr>",
      css: "",
      entries: [],
      metadata: META,
    });
    const chapter = await (await loadEpub(bytes)).file("OEBPS/chapter.xhtml")?.async("string");
    expect(chapter).toContain("<br />");
    expect(chapter).toContain("<hr />");
    // Re-parsing as XML must not produce a parser-error element. Drop the
    // stylesheet <link> first so the test DOM doesn't try to fetch it.
    const xml = (chapter ?? "").replace(/<link[^>]*\/>/, "");
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    expect(doc.querySelector("parsererror")).toBeNull();
  });

  it("omits the creator element when there is no author", async () => {
    const bytes = await buildEpub({
      bodyHtml: "<p>x</p>",
      css: "",
      entries: [],
      metadata: { ...META, author: undefined },
    });
    const opf = await (await loadEpub(bytes)).file("OEBPS/content.opf")?.async("string");
    expect(opf).not.toContain("dc:creator");
  });
});
