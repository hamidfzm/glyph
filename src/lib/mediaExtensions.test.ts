import { describe, expect, it } from "vitest";
import { isAudioFile, isMediaFile, isVideoFile, mediaMimeType } from "./mediaExtensions";

describe("mediaExtensions", () => {
  it("classifies video and audio files", () => {
    expect(isVideoFile("clip.mp4")).toBe(true);
    expect(isVideoFile("CLIP.WEBM")).toBe(true);
    expect(isAudioFile("memo.mp3")).toBe(true);
    expect(isVideoFile("memo.mp3")).toBe(false);
    expect(isAudioFile("clip.mp4")).toBe(false);
    expect(isMediaFile("cover.png")).toBe(false);
    expect(isMediaFile("notes")).toBe(false);
  });

  it("ignores a query string or fragment on the reference", () => {
    expect(isVideoFile("clip.mp4?v=2")).toBe(true);
    expect(isAudioFile("memo.mp3#t=30")).toBe(true);
  });

  it("maps packaged files to their media type", () => {
    expect(mediaMimeType("clip.mp4")).toBe("video/mp4");
    expect(mediaMimeType("clip.mov")).toBe("video/mp4");
    expect(mediaMimeType("memo.mp3")).toBe("audio/mpeg");
    expect(mediaMimeType("memo.opus")).toBe("audio/ogg");
    expect(mediaMimeType("cover.png")).toBeUndefined();
  });
});
