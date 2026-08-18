import { afterEach, describe, expect, it, vi } from "vitest";
import { packageExportMedia } from "./mediaAssets";

const MB = 1024 * 1024;

function mockFetch(bytes: number, declared: number | null = bytes) {
  const headers = new Headers(declared === null ? {} : { "content-length": String(declared) });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      headers,
      arrayBuffer: async () => new ArrayBuffer(bytes),
    })),
  );
}

function body(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("packageExportMedia", () => {
  it("degrades a local video to a poster frame and a link", async () => {
    const el = body(
      '<video src="asset://localhost/notes/clip.mp4" poster="asset://localhost/notes/cover.png"' +
        ' data-media-path="/notes/clip.mp4" data-poster-path="/notes/cover.png"></video>',
    );

    const packaged = await packageExportMedia(el, 0);

    expect(packaged).toEqual([]);
    expect(el.querySelector("video")).toBeNull();
    expect(el.querySelector("a")?.getAttribute("href")).toBe("clip.mp4");
    // The poster is its own paragraph: the PDF walker only embeds an image
    // that is a paragraph's sole child.
    const frame = el.querySelector("p > img");
    expect(frame?.getAttribute("src")).toBe("asset://localhost/notes/cover.png");
    expect(frame?.closest("a")).toBeNull();
  });

  it("names the link after the file when there is no poster", async () => {
    const el = body(
      '<audio src="asset://localhost/notes/memo.mp3" data-media-path="/notes/memo.mp3"></audio>',
    );

    await packageExportMedia(el, 0);

    expect(el.querySelector("a")?.textContent).toBe("memo.mp3");
    expect(el.querySelector("img")).toBeNull();
  });

  it("falls back for a remote source and never fetches it", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const el = body('<video src="https://example.com/clip.mp4"></video>');

    const packaged = await packageExportMedia(el, 50 * MB);

    expect(packaged).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(el.querySelector("a")?.getAttribute("href")).toBe("clip.mp4");
  });

  it("packages a local file under the limit and points the element at it", async () => {
    mockFetch(2 * MB);
    const el = body(
      '<video src="asset://localhost/notes/clip.mp4" poster="asset://localhost/notes/cover.png"' +
        ' data-media-path="/notes/clip.mp4"></video>',
    );

    const packaged = await packageExportMedia(el, 10 * MB);

    expect(packaged).toHaveLength(1);
    expect(packaged[0].mediaType).toBe("video/mp4");
    expect(packaged[0].bytes.byteLength).toBe(2 * MB);
    const video = el.querySelector("video");
    expect(video?.getAttribute("src")).toBe(packaged[0].href);
    expect(video?.hasAttribute("poster")).toBe(false);
  });

  it("refuses a file over the limit before reading its body", async () => {
    mockFetch(0, 40 * MB);
    const el = body(
      '<video src="asset://localhost/notes/big.mp4" data-media-path="/notes/big.mp4"></video>',
    );

    const packaged = await packageExportMedia(el, 10 * MB);

    expect(packaged).toEqual([]);
    expect(el.querySelector("a")?.getAttribute("href")).toBe("big.mp4");
  });

  it("catches an oversized body when no length was declared", async () => {
    mockFetch(20 * MB, null);
    const el = body(
      '<video src="asset://localhost/notes/big.mp4" data-media-path="/notes/big.mp4"></video>',
    );

    const packaged = await packageExportMedia(el, 10 * MB);

    expect(packaged).toEqual([]);
  });

  it("packages the first source child when the element carries no src", async () => {
    mockFetch(MB);
    const el = body(
      '<video><source src="asset://localhost/notes/clip.webm" data-media-path="/notes/clip.webm"></video>',
    );

    const packaged = await packageExportMedia(el, 10 * MB);

    expect(packaged[0].mediaType).toBe("video/webm");
    // The child would still point at an asset: URL the container cannot resolve.
    expect(el.querySelector("source")).toBeNull();
    expect(el.querySelector("video")?.getAttribute("src")).toBe(packaged[0].href);
  });

  it("strips the exporter-only path attributes from the output", async () => {
    mockFetch(MB);
    const el = body(
      '<video src="asset://localhost/notes/clip.mp4" data-media-path="/notes/clip.mp4"' +
        ' data-poster-path="/notes/cover.png"></video>',
    );

    await packageExportMedia(el, 10 * MB);

    expect(el.innerHTML).not.toContain("data-media-path");
    expect(el.innerHTML).not.toContain("data-poster-path");
  });
});
