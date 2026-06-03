import JSZip from "jszip";
import type { TocEntry } from "@/hooks/useTableOfContents";
import { escapeXml } from "./escape";

export interface EpubMetadata {
  title: string;
  author?: string;
  language: string;
  // Unique book identifier (a UUID); the caller generates it.
  identifier: string;
  // ISO 8601 UTC timestamp for the required dcterms:modified property.
  modified: string;
}

export interface EpubInput {
  bodyHtml: string;
  css: string;
  entries: TocEntry[];
  metadata: EpubMetadata;
  bodyClass?: "markdown-body" | "notebook-body";
}

const MIMETYPE = "application/epub+zip";

// EPUB readers paginate to a fixed width, so wide code must wrap rather than
// clip. Appended after the collected app CSS (which sets overflow-x: auto).
const CODE_WRAP_CSS = `
.markdown-body pre, .notebook-body pre, .markdown-body pre code, .notebook-body pre code { white-space: pre-wrap; overflow-wrap: anywhere; overflow-x: visible; }`;
const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

// Re-serialize an HTML5 fragment as well-formed XHTML: parsing as text/html
// resolves named entities to literal characters and XMLSerializer self-closes
// void tags, both of which EPUB's XML parser requires.
function toXhtml(bodyHtml: string): string {
  // Serialize the whole <body> subtree (always present) for consistent
  // void-element output, then strip the <body> wrapper. doc.body is never null,
  // so there's no dead branch to test.
  const doc = new DOMParser().parseFromString(bodyHtml, "text/html");
  return new XMLSerializer()
    .serializeToString(doc.body)
    .replace(/^<body[^>]*>/, "")
    .replace(/<\/body>$/, "");
}

function buildOpf(meta: EpubMetadata): string {
  const author = meta.author
    ? `\n    <dc:creator id="author">${escapeXml(meta.author)}</dc:creator>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:${escapeXml(meta.identifier)}</dc:identifier>
    <dc:title>${escapeXml(meta.title)}</dc:title>
    <dc:language>${escapeXml(meta.language)}</dc:language>${author}
    <meta property="dcterms:modified">${escapeXml(meta.modified)}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
    <item id="style" href="style.css" media-type="text/css"/>
  </manifest>
  <spine>
    <itemref idref="chapter"/>
  </spine>
</package>`;
}

function buildNav(title: string, entries: TocEntry[]): string {
  const items = entries
    .map(
      (e) => `      <li><a href="chapter.xhtml#${escapeXml(e.id)}">${escapeXml(e.text)}</a></li>`,
    )
    .join("\n");
  const list = items ? `\n${items}\n    ` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head><meta charset="utf-8"/><title>${escapeXml(title)}</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>${escapeXml(title)}</h1>
    <ol>${list}</ol>
  </nav>
</body>
</html>`;
}

function buildChapter(title: string, bodyHtml: string, bodyClass: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head><meta charset="utf-8"/><title>${escapeXml(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
<div class="${bodyClass}">
${toXhtml(bodyHtml)}
</div>
</body>
</html>`;
}

/**
 * Assemble a minimal, valid EPUB 3 from prepared body HTML. The whole document
 * is one content file (`chapter.xhtml`); the nav links to in-document anchors,
 * which every EPUB 3 reader resolves. Images are expected to already be inlined
 * as data URIs by `prepareContent`.
 *
 * `mimetype` must be the first entry and stored uncompressed per the EPUB spec.
 */
export async function buildEpub({
  bodyHtml,
  css,
  entries,
  metadata,
  bodyClass = "markdown-body",
}: EpubInput): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("mimetype", MIMETYPE, { compression: "STORE" });
  zip.file("META-INF/container.xml", CONTAINER_XML);
  zip.file("OEBPS/content.opf", buildOpf(metadata));
  zip.file("OEBPS/nav.xhtml", buildNav(metadata.title, entries));
  zip.file("OEBPS/style.css", css + CODE_WRAP_CSS);
  zip.file("OEBPS/chapter.xhtml", buildChapter(metadata.title, bodyHtml, bodyClass));
  return zip.generateAsync({ type: "uint8array" });
}
