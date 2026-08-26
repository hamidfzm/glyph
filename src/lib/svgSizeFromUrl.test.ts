import { afterEach, describe, expect, it, vi } from "vitest";
import { svgSizeFromUrl } from "./svgSizeFromUrl";

// happy-dom does no layout, so probe geometry is stamped onto created imgs.
function stubProbeImg(offsetWidth: number, complete = true) {
  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    const el = realCreate(tag);
    if (tag === "img") {
      Object.defineProperty(el, "offsetWidth", { value: offsetWidth, configurable: true });
      Object.defineProperty(el, "complete", { value: complete, configurable: true });
    }
    return el;
  });
}

describe("svgSizeFromUrl", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("decodes an SVG data URL without touching the DOM", async () => {
    const createSpy = vi.spyOn(document, "createElement");
    const src = `data:image/svg+xml,${encodeURIComponent('<svg viewBox="0 0 200 100"/>')}`;
    await expect(svgSizeFromUrl(src)).resolves.toEqual({ w: 200, h: 100 });
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("returns null for a non-SVG data URL", async () => {
    await expect(svgSizeFromUrl("data:image/png;base64,AAAA")).resolves.toBeNull();
  });

  it("measures other URLs with a hidden fixed-height probe", async () => {
    stubProbeImg(1600);
    await expect(svgSizeFromUrl("http://asset.localhost/diagram.svg")).resolves.toEqual({
      w: 1600,
      h: 1000,
    });
    // The probe cleans up after itself.
    expect(document.querySelectorAll("img")).toHaveLength(0);
  });

  it("measures after the load event when the probe image is not yet complete", async () => {
    stubProbeImg(800, false);
    const pending = svgSizeFromUrl("http://asset.localhost/slow.svg");
    document.querySelector("img")?.dispatchEvent(new Event("load"));
    await expect(pending).resolves.toEqual({ w: 800, h: 1000 });
  });

  it("resolves null when the probe fails to load or measures nothing", async () => {
    stubProbeImg(0);
    await expect(svgSizeFromUrl("http://asset.localhost/empty.svg")).resolves.toBeNull();

    vi.restoreAllMocks();
    stubProbeImg(999, false);
    const pending = svgSizeFromUrl("http://asset.localhost/broken.svg");
    document.querySelector("img")?.dispatchEvent(new Event("error"));
    await expect(pending).resolves.toBeNull();
  });
});
