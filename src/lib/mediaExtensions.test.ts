import { describe, expect, it } from "vitest";
import { mediaMimeType } from "./mediaExtensions";

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
});
