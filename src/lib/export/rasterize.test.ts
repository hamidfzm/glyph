import { beforeEach, describe, expect, it, vi } from "vitest";
import { rasterizeSvgsInHtml, renderMermaidLightSvg, restoreMermaidTheme } from "./rasterize";

const initialize = vi.fn();
const renderMermaid = vi.fn();
vi.mock("mermaid", () => ({
  default: {
    initialize: (...args: unknown[]) => initialize(...args),
    render: (...args: unknown[]) => renderMermaid(...args),
  },
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
});
