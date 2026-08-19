import { describe, expect, it } from "vitest";
import { mediaLabel, mediaMimeType } from "./mediaExtensions";

describe("mediaMimeType", () => {
  it("maps packageable files to their media type", () => {
    expect(mediaMimeType("clip.mp4")).toBe("video/mp4");
    expect(mediaMimeType("CLIP.WEBM")).toBe("video/webm");
    expect(mediaMimeType("clip.mov")).toBe("video/mp4");
    expect(mediaMimeType("memo.mp3")).toBe("audio/mpeg");
    expect(mediaMimeType("memo.opus")).toBe("audio/ogg");
  });

  it("declines anything it cannot declare a type for", () => {
    expect(mediaMimeType("cover.png")).toBeUndefined();
    expect(mediaMimeType("clip.mkv")).toBeUndefined();
    expect(mediaMimeType("notes")).toBeUndefined();
  });

  it("declares nothing for an extension that only exists on Object's prototype", () => {
    // A truthy inherited value would be packaged and then handed to the EPUB
    // manifest, which escapes it as a string.
    expect(mediaMimeType("/ws/clip.constructor")).toBeUndefined();
    expect(mediaMimeType("/ws/clip.__proto__")).toBeUndefined();
  });
});

describe("mediaLabel", () => {
  it("names a local file, since nothing carries it off the page", () => {
    expect(mediaLabel("/ws/notes/clip.mp4", "clip.mp4")).toBe("clip.mp4");
  });

  it("keeps a remote URL whole, the only form that still leads anywhere", () => {
    expect(mediaLabel(undefined, "https://example.com/a/b/clip.mp4")).toBe(
      "https://example.com/a/b/clip.mp4",
    );
  });

  it("has nothing to say about an element with no source of its own", () => {
    expect(mediaLabel(undefined, undefined)).toBe("");
  });
});
