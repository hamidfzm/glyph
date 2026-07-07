import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  rasterizeElement,
  rasterizeSvgsInHtml,
  renderMermaidLightSvg,
  restoreMermaidTheme,
  svgToPng,
} from "./rasterize";

const initialize = vi.fn();
const renderMermaid = vi.fn();
vi.mock("mermaid", () => ({
  default: {
    initialize: (...args: unknown[]) => initialize(...args),
    render: (...args: unknown[]) => renderMermaid(...args),
  },
}));

const html2canvas = vi.fn();
vi.mock("html2canvas", () => ({
  default: (...args: unknown[]) => html2canvas(...args),
}));

describe("renderMermaidLightSvg", () => {
  beforeEach(() => {
    initialize.mockReset();
    renderMermaid.mockReset();
  });

  it("re-renders light with SVG text labels and returns the markup", async () => {
    renderMermaid.mockResolvedValue({ svg: "<svg data-light='1'></svg>" });
    const svg = await renderMermaidLightSvg("graph TD; A-->B");
    expect(svg).toBe("<svg data-light='1'></svg>");
    expect(initialize).toHaveBeenCalledWith({
      startOnLoad: false,
      theme: "default",
      flowchart: { htmlLabels: false },
    });
  });

  it("passes a fresh id per render (Mermaid keeps state per id)", async () => {
    renderMermaid.mockResolvedValue({ svg: "<svg/>" });
    await renderMermaidLightSvg("graph TD; A-->B");
    await renderMermaidLightSvg("graph TD; A-->B");
    const ids = renderMermaid.mock.calls.map((c) => c[0]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("restoreMermaidTheme re-initializes with the app theme and HTML labels", async () => {
    await restoreMermaidTheme(true);
    expect(initialize).toHaveBeenCalledWith({
      startOnLoad: false,
      theme: "dark",
      flowchart: { htmlLabels: true },
    });
  });
});

describe("rasterizeElement", () => {
  it("rasterizes a live element via html2canvas at 2x scale", async () => {
    html2canvas.mockResolvedValue({ toDataURL: () => "data:image/png;base64,ELEMENT" });
    const el = document.createElement("div");
    await expect(rasterizeElement(el, "#ffffff")).resolves.toBe("data:image/png;base64,ELEMENT");
    expect(html2canvas).toHaveBeenCalledWith(el, {
      backgroundColor: "#ffffff",
      scale: 2,
      logging: false,
    });
  });
});

describe("rasterizeSvgsInHtml", () => {
  // `toPng` is injected: the real svgToPng needs a browser canvas.
  const toPng = vi.fn(async (_svg: string) => "data:image/png;base64,RASTER");

  beforeEach(() => {
    toPng.mockClear();
  });

  it("replaces <svg> elements with PNG <img> tags", async () => {
    const html = '<p>before</p><svg width="10"><rect/></svg><p>after</p>';
    const out = await rasterizeSvgsInHtml(html, toPng);
    expect(out).not.toContain("<svg");
    expect(out).toContain('src="data:image/png;base64,RASTER"');
    expect(out).toContain("before");
    expect(out).toContain("after");
    // The markup handed to the rasterizer regains its xmlns (required for
    // decoding via a standalone <img>).
    expect(toPng.mock.calls[0][0]).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it("rewrites data:image/svg+xml image sources to PNG", async () => {
    const uri = `data:image/svg+xml,${encodeURIComponent("<svg><rect/></svg>")}`;
    const out = await rasterizeSvgsInHtml(`<img src="${uri}">`, toPng);
    expect(out).toContain('src="data:image/png;base64,RASTER"');
    expect(out).not.toContain("svg+xml");
  });

  it("leaves raster images untouched", async () => {
    const html = '<img src="data:image/png;base64,KEEP">';
    expect(await rasterizeSvgsInHtml(html, toPng)).toContain("KEEP");
    expect(toPng).not.toHaveBeenCalled();
  });

  it("drops an element whose rasterization fails instead of aborting", async () => {
    toPng.mockRejectedValueOnce(new Error("no canvas"));
    const out = await rasterizeSvgsInHtml("<svg><rect/></svg><p>kept</p>", toPng);
    expect(out).not.toContain("<svg");
    expect(out).not.toContain("<img");
    expect(out).toContain("kept");
  });

  it("drops a data: SVG image whose rasterization fails", async () => {
    toPng.mockRejectedValueOnce(new Error("no canvas"));
    const uri = `data:image/svg+xml,${encodeURIComponent("<svg><rect/></svg>")}`;
    const out = await rasterizeSvgsInHtml(`<img src="${uri}"><p>kept</p>`, toPng);
    expect(out).not.toContain("<img");
    expect(out).toContain("kept");
  });
});

describe("svgToPng", () => {
  // jsdom has no blob URLs, no image decoding, and no canvas: each seam is
  // stubbed so the promise wiring (dimensions, fallbacks, cleanup) is testable.
  const image = { naturalWidth: 100, naturalHeight: 50, fail: false };
  const ctx = { scale: vi.fn(), fillRect: vi.fn(), drawImage: vi.fn(), fillStyle: "" };
  let getContext: ReturnType<typeof vi.spyOn>;

  class FakeImage {
    naturalWidth = image.naturalWidth;
    naturalHeight = image.naturalHeight;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_value: string) {
      queueMicrotask(() => (image.fail ? this.onerror?.() : this.onload?.()));
    }
  }

  beforeEach(() => {
    image.naturalWidth = 100;
    image.naturalHeight = 50;
    image.fail = false;
    ctx.drawImage.mockClear();
    vi.stubGlobal("Image", FakeImage);
    URL.createObjectURL = vi.fn(() => "blob:mock");
    URL.revokeObjectURL = vi.fn();
    getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,PNG");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("draws the image on a white 2x canvas and revokes the blob URL", async () => {
    await expect(svgToPng("<svg/>")).resolves.toBe("data:image/png;base64,PNG");
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.any(FakeImage), 0, 0, 100, 50);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock");
  });

  it("falls back to 800x600 when the image reports no size", async () => {
    image.naturalWidth = 0;
    image.naturalHeight = 0;
    await svgToPng("<svg/>");
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.any(FakeImage), 0, 0, 800, 600);
  });

  it("rejects when the canvas has no 2d context", async () => {
    getContext.mockReturnValue(null);
    await expect(svgToPng("<svg/>")).rejects.toThrow("no 2d context");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock");
  });

  it("rejects when the SVG fails to decode", async () => {
    image.fail = true;
    await expect(svgToPng("<svg/>")).rejects.toThrow("svg load failed");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock");
  });
});
