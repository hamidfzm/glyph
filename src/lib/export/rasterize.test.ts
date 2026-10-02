import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rasterizeElement, rasterizeSvgsInHtml, svgToPng } from "./rasterize";

const html2canvas = vi.fn();
vi.mock("html2canvas", () => ({
  default: (...args: unknown[]) => html2canvas(...args),
}));

describe("rasterizeElement", () => {
  it("captures at 2x on white and reports the on-screen width in points", async () => {
    html2canvas.mockResolvedValue({ width: 400, toDataURL: () => "data:image/png;base64,ELEMENT" });
    const el = document.createElement("div");
    await expect(rasterizeElement(el, "fit-content")).resolves.toEqual({
      src: "data:image/png;base64,ELEMENT",
      width: 150,
    });
    expect(html2canvas).toHaveBeenCalledWith(
      el,
      expect.objectContaining({ backgroundColor: "#ffffff", scale: 2, logging: false }),
    );
  });

  it("lays out html2canvas's clone light, at the given width, with SVG paint re-resolved", async () => {
    html2canvas.mockResolvedValue({ width: 2, toDataURL: () => "" });
    await rasterizeElement(document.createElement("p"), "686px");
    const [, { onclone }] = html2canvas.mock.lastCall as [
      HTMLElement,
      { onclone: (doc: Document, clone: HTMLElement) => void },
    ];
    // Stand-in for html2canvas's cloned document: dark, with the live dark
    // paint inlined on its SVG nodes.
    document.documentElement.classList.add("dark");
    const theme = document.createElement("style");
    theme.textContent = "svg { fill: rgb(1, 2, 3); } .dark svg { fill: rgb(238, 238, 238); }";
    document.head.append(theme);
    const clone = document.createElement("p");
    clone.innerHTML = '<svg style="fill: rgb(238, 238, 238)"></svg>';
    document.body.append(clone);
    try {
      onclone(document, clone);
      expect(document.documentElement.classList.contains("dark")).toBe(false);
      expect(clone.style.width).toBe("686px");
      expect(clone.querySelector("svg")?.style.fill).toBe("rgb(1, 2, 3)");
    } finally {
      theme.remove();
      clone.remove();
      document.documentElement.classList.remove("dark");
    }
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
