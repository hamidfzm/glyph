import { render, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
// A workspace root turns on the clamp that refuses references escaping it;
// without one the components run in single-file mode.
import { renderInWorkspace } from "@/test/renderInWorkspace";
import { useAudioComponent, useMediaSourceComponent, useVideoComponent } from "./MediaComponent";

describe("useVideoComponent", () => {
  it("resolves a relative src through the asset protocol", () => {
    const { result } = renderHook(() => useVideoComponent("/notes/doc.md"));
    const Video = result.current;
    const { container } = render(<Video src="media/clip.mp4" />);
    const src = container.querySelector("video")?.getAttribute("src") ?? "";
    expect(src).toMatch(/^asset:\/\/localhost\//);
    expect(src).toContain("/notes/media/clip.mp4");
  });

  it("keeps a remote src unchanged", () => {
    const { result } = renderHook(() => useVideoComponent("/notes/doc.md"));
    const Video = result.current;
    const { container } = render(<Video src="https://example.com/clip.mp4" />);
    expect(container.querySelector("video")?.getAttribute("src")).toBe(
      "https://example.com/clip.mp4",
    );
  });

  it("renders with controls and preload=none", () => {
    const { result } = renderHook(() => useVideoComponent("/notes/doc.md"));
    const Video = result.current;
    const { container } = render(<Video src="clip.mp4" />);
    const video = container.querySelector("video");
    expect(video?.getAttribute("preload")).toBe("none");
    expect(video?.hasAttribute("controls")).toBe(true);
  });

  it("resolves the poster frame and carries the source path for exporters", () => {
    const { result } = renderHook(() => useVideoComponent("/notes/doc.md"));
    const Video = result.current;
    const { container } = render(<Video src="clip.mp4" poster="cover.png" />);
    const video = container.querySelector("video");
    expect(video?.getAttribute("poster")).toContain("/notes/cover.png");
    expect(video?.getAttribute("data-media-path")).toContain("/notes/clip.mp4");
  });

  it("renders nothing when the src escapes the workspace root", () => {
    const { result } = renderHook(() => useVideoComponent("/notes/doc.md"));
    const Video = result.current;
    const { container } = renderInWorkspace(<Video src="../../secrets/clip.mp4" />, "/notes");
    expect(container.querySelector("video")).toBeNull();
  });

  it("drops a poster that escapes the workspace root but keeps the video", () => {
    const { result } = renderHook(() => useVideoComponent("/notes/doc.md"));
    const Video = result.current;
    const { container } = renderInWorkspace(
      <Video src="clip.mp4" poster="../../secrets/cover.png" />,
      "/notes",
    );
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video?.hasAttribute("poster")).toBe(false);
  });

  it("renders nothing when a refused src is left with only whitespace children", () => {
    const { result } = renderHook(() => useVideoComponent("/notes/doc.md"));
    const Video = result.current;
    const { container } = renderInWorkspace(<Video src="../../secrets/clip.mp4"> </Video>);
    expect(container.querySelector("video")).toBeNull();
  });

  it("keeps a video whose only playable source is a child", () => {
    const { result } = renderHook(() => useVideoComponent("/notes/doc.md"));
    const Video = result.current;
    const node = {
      children: [{ type: "element", tagName: "source", properties: { src: "clip.webm" } }],
    };
    const { container } = renderInWorkspace(
      <Video node={node as never}>
        <source src="clip.webm" />
      </Video>,
      "/notes",
    );
    expect(container.querySelector("video")).not.toBeNull();
  });

  it("looks past the whitespace between the tags to find a playable source", () => {
    const { result } = renderHook(() => useVideoComponent("/notes/doc.md"));
    const Video = result.current;
    const node = {
      children: [
        { type: "text", value: " " },
        { type: "element", tagName: "source", properties: { src: "clip.webm" } },
      ],
    };
    const { container } = renderInWorkspace(
      <Video node={node as never}>
        <source src="clip.webm" />
      </Video>,
      "/notes",
    );
    expect(container.querySelector("video")).not.toBeNull();
  });

  it("does not treat the whitespace itself as something to play", () => {
    const { result } = renderHook(() => useVideoComponent("/notes/doc.md"));
    const Video = result.current;
    const node = { children: [{ type: "text", value: "\n" }] };
    const { container } = renderInWorkspace(
      <Video src="../../secrets/clip.mp4" node={node as never}>
        {" "}
      </Video>,
      "/notes",
    );
    expect(container.querySelector("video")).toBeNull();
  });

  it("renders nothing when every child source escapes the workspace root too", () => {
    const { result } = renderHook(() => useVideoComponent("/notes/doc.md"));
    const Video = result.current;
    const node = {
      children: [
        { type: "element", tagName: "source", properties: { src: "../../secrets/clip.webm" } },
      ],
    };
    const { container } = renderInWorkspace(
      <Video src="../../secrets/clip.mp4" node={node as never}>
        <source src="../../secrets/clip.webm" />
      </Video>,
      "/notes",
    );
    expect(container.querySelector("video")).toBeNull();
  });
});

describe("useAudioComponent", () => {
  it("resolves a relative src and carries no poster", () => {
    const { result } = renderHook(() => useAudioComponent("/notes/doc.md"));
    const Audio = result.current;
    const { container } = render(<Audio src="memo.mp3" />);
    const audio = container.querySelector("audio");
    expect(audio?.getAttribute("src")).toContain("/notes/memo.mp3");
    expect(audio?.hasAttribute("poster")).toBe(false);
    expect(audio?.getAttribute("preload")).toBe("none");
  });
});

describe("useMediaSourceComponent", () => {
  it("resolves its own src", () => {
    const { result } = renderHook(() => useMediaSourceComponent("/notes/doc.md"));
    const Source = result.current;
    const { container } = render(<Source src="media/clip.webm" type="video/webm" />);
    const source = container.querySelector("source");
    expect(source?.getAttribute("src")).toContain("/notes/media/clip.webm");
    expect(source?.getAttribute("data-media-path")).toContain("/notes/media/clip.webm");
  });

  it("renders nothing when its src escapes the workspace root", () => {
    const { result } = renderHook(() => useMediaSourceComponent("/notes/doc.md"));
    const Source = result.current;
    const { container } = renderInWorkspace(<Source src="../../secrets/clip.webm" />, "/notes");
    expect(container.querySelector("source")).toBeNull();
  });
});
