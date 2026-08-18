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
        ' data-media-path="/notes/clip.mp4"></video>',
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
    // The remote URL is the only place that copy can still be reached, so the
    // link keeps it and only the label is shortened to the file name.
    expect(el.querySelector("a")?.getAttribute("href")).toBe("https://example.com/clip.mp4");
    expect(el.querySelector("a")?.textContent).toBe("clip.mp4");
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

  it("strips the exporter-only path attribute from the output", async () => {
    mockFetch(MB);
    const el = body(
      '<video src="asset://localhost/notes/clip.mp4" data-media-path="/notes/clip.mp4"></video>',
    );

    await packageExportMedia(el, 10 * MB);

    expect(el.innerHTML).not.toContain("data-media-path");
  });

  it("names the fallback link after a source child when the element has no src", async () => {
    const el = body(
      '<video><source src="asset://localhost/notes/clip.webm" data-media-path="/notes/clip.webm"></video>',
    );

    await packageExportMedia(el, 0);

    expect(el.querySelector("a")?.getAttribute("href")).toBe("clip.webm");
  });

  it("falls back when the asset read fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, headers: new Headers() })),
    );
    const el = body(
      '<video src="asset://localhost/notes/clip.mp4" data-media-path="/notes/clip.mp4"></video>',
    );

    const packaged = await packageExportMedia(el, 10 * MB);

    expect(packaged).toEqual([]);
    expect(el.querySelector("a")?.getAttribute("href")).toBe("clip.mp4");
  });

  it("falls back for a container it cannot declare a media type for", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const el = body(
      '<video src="asset://localhost/notes/clip.mkv" data-media-path="/notes/clip.mkv"></video>',
    );

    const packaged = await packageExportMedia(el, 10 * MB);

    expect(packaged).toEqual([]);
    // An EPUB manifest entry needs a media type, so it is never read at all.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("falls back when the read throws, rather than aborting the export", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network");
      }),
    );
    const el = body(
      '<video src="asset://localhost/notes/clip.mp4" data-media-path="/notes/clip.mp4"></video>',
    );

    await expect(packageExportMedia(el, 10 * MB)).resolves.toEqual([]);
    expect(el.querySelector("a")?.getAttribute("href")).toBe("clip.mp4");
  });

  it("packages a file once when two elements play it", async () => {
    mockFetch(MB);
    const el = body(
      '<video src="asset://localhost/notes/clip.mp4" data-media-path="/notes/clip.mp4"></video>' +
        '<video src="asset://localhost/notes/clip.mp4" data-media-path="/notes/clip.mp4"></video>',
    );

    const packaged = await packageExportMedia(el, 10 * MB);

    expect(packaged).toHaveLength(1);
    const players = el.querySelectorAll("video");
    expect(players[0].getAttribute("src")).toBe(packaged[0].href);
    expect(players[1].getAttribute("src")).toBe(packaged[0].href);
  });

  it("spends the limit as a whole-container budget, not per file", async () => {
    mockFetch(6 * MB);
    const el = body(
      '<video src="asset://localhost/notes/one.mp4" data-media-path="/notes/one.mp4"></video>' +
        '<video src="asset://localhost/notes/two.mp4" data-media-path="/notes/two.mp4"></video>',
    );

    const packaged = await packageExportMedia(el, 10 * MB);

    // The second file fits the per-file limit but not what is left of it.
    expect(packaged).toHaveLength(1);
    expect(el.querySelectorAll("video")).toHaveLength(1);
    expect(el.querySelector("a")?.getAttribute("href")).toBe("two.mp4");
  });

  it("encodes the href while the zip entry keeps the file name", async () => {
    mockFetch(MB);
    const el = body(
      '<video src="asset://localhost/notes/clip%20%232.mp4" data-media-path="/notes/clip #2.mp4"></video>',
    );

    const packaged = await packageExportMedia(el, 10 * MB);

    // A raw space or # in the reference would truncate or invalidate it.
    expect(packaged[0].zipPath).toBe("media/0-clip #2.mp4");
    expect(packaged[0].href).toBe("media/0-clip%20%232.mp4");
    expect(el.querySelector("video")?.getAttribute("src")).toBe(packaged[0].href);
  });

  it("drops an orphan <source> so its asset URL cannot leak the local path", async () => {
    const el = body(
      '<p><source src="asset://localhost/notes/clip.mp4" data-media-path="/notes/clip.mp4"></p>',
    );

    await packageExportMedia(el, 0);

    expect(el.querySelector("source")).toBeNull();
    expect(el.innerHTML).not.toContain("asset://localhost");
  });

  it("removes a media element that names no file at all", async () => {
    const el = body("<video></video>");

    await packageExportMedia(el, 10 * MB);

    // An empty anchor would link back at the exported document itself.
    expect(el.querySelector("video")).toBeNull();
    expect(el.querySelector("a")).toBeNull();
  });

  it("names but does not link a source a browser should not follow", async () => {
    const el = body('<video src="javascript:alert(1)"></video>');

    await packageExportMedia(el, 0);

    expect(el.querySelector("a")).toBeNull();
    expect(el.textContent).toBe("javascript:alert(1)");
  });
});
