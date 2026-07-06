import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPdf } from "./pdf";

describe("buildPdf", () => {
  it("produces a PDF byte stream with the %PDF signature", async () => {
    const bytes = await buildPdf("<h1>Title</h1><p>Body with <strong>bold</strong>.</p>", {
      title: "Doc",
      author: "Ada",
    });
    expect(bytes.length).toBeGreaterThan(100);
    // "%PDF"
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x25, 0x50, 0x44, 0x46]);
  });

  it("handles lists, tables, code, quotes, and links without throwing", async () => {
    const html =
      "<ol><li>one</li><li>two<ul><li>nested</li></ul></li></ol>" +
      "<table><tr><th>H</th></tr><tr><td>c</td></tr></table>" +
      "<blockquote><p>quote</p></blockquote>" +
      "<pre>const a = 1;\nconst b = 2;</pre>" +
      "<hr>" +
      '<p><a href="https://example.com">link</a></p>';
    const bytes = await buildPdf(html, { title: "Doc" });
    expect(bytes.length).toBeGreaterThan(100);
  });

  it("embeds a vector SVG diagram through the real engine", async () => {
    // Exercises pdfmake's actual svg-to-pdfkit path with a diagram-shaped SVG.
    const html =
      "<h1>Diagram</h1>" +
      '<svg width="120" height="60" viewBox="0 0 120 60">' +
      '<rect x="4" y="4" width="112" height="52" fill="#ffdfb5" stroke="#0d32b2"/>' +
      '<text x="60" y="35" text-anchor="middle" fill="#0d32b2">node</text>' +
      "</svg>";
    const bytes = await buildPdf(html, { title: "Doc" });
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x25, 0x50, 0x44, 0x46]);
  });
});

describe("buildPdf raster fallback", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("retries once with rasterized SVGs when the vector build throws", async () => {
    const getBuffer = vi
      .fn()
      .mockRejectedValueOnce(new Error("unsupported svg"))
      .mockResolvedValue(new ArrayBuffer(8));
    const createPdf = vi.fn(() => ({ getBuffer }));
    vi.doMock("./pdfEngine", () => ({ pdfEngine: () => ({ createPdf }) }));
    const rasterizeSvgsInHtml = vi.fn(async () => "<p>rasterized</p>");
    vi.doMock("./rasterize", () => ({ rasterizeSvgsInHtml }));

    const { buildPdf: build } = await import("./pdf");
    const bytes = await build("<svg><rect/></svg>", { title: "Doc" });

    expect(rasterizeSvgsInHtml).toHaveBeenCalledWith("<svg><rect/></svg>");
    expect(createPdf).toHaveBeenCalledTimes(2);
    expect(bytes).toBeInstanceOf(Uint8Array);
  });

  it("propagates the error when the raster retry also fails", async () => {
    const getBuffer = vi.fn().mockRejectedValue(new Error("engine down"));
    vi.doMock("./pdfEngine", () => ({ pdfEngine: () => ({ createPdf: () => ({ getBuffer }) }) }));
    vi.doMock("./rasterize", () => ({ rasterizeSvgsInHtml: vi.fn(async (h: string) => h) }));

    const { buildPdf: build } = await import("./pdf");
    await expect(build("<p>x</p>", { title: "Doc" })).rejects.toThrow("engine down");
  });
});
