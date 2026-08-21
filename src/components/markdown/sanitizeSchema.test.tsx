import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownContent } from "./MarkdownContent";

// MarkdownContent runs rehype-raw + the shared sanitizer, so rendering an inline
// <svg> exercises markdownSanitizeSchema end to end.
function renderHtml(content: string): string {
  const { container } = render(<MarkdownContent content={content} showFrontmatter={false} />);
  return container.innerHTML.toLowerCase();
}

describe("markdownSanitizeSchema inline SVG", () => {
  it("keeps static drawing primitives and gradients", () => {
    const svg = [
      '<svg viewBox="0 0 20 20" width="20" height="20">',
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">',
      '<stop offset="0" stop-color="#6366f1" /></linearGradient></defs>',
      '<rect x="0" y="0" width="20" height="20" rx="3" fill="url(#g)" />',
      '<circle cx="10" cy="10" r="4" fill-opacity="0.5" />',
      '<path d="M2 2 L8 8" stroke="#fff" stroke-width="2" />',
      '<text x="4" y="6" text-anchor="middle" font-size="6">hi</text>',
      "</svg>",
    ].join("");

    const html = renderHtml(svg);
    for (const tag of ["<rect", "<circle", "<path", "<text", "lineargradient", "<stop"]) {
      expect(html).toContain(tag);
    }
    // Geometry/paint attributes survive too.
    expect(html).toContain("viewbox");
    expect(html).toContain("stroke-width");
    expect(html).toContain("fill-opacity");
  });

  it("strips unsafe SVG content (foreignObject, script)", () => {
    const evil =
      '<svg viewBox="0 0 10 10"><foreignObject>html</foreignObject>' +
      "<script>alert(1)</script><rect /></svg>";

    const html = renderHtml(evil);
    expect(html).toContain("<rect");
    expect(html).not.toContain("foreignobject");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(1)");
  });
});

describe("markdownSanitizeSchema media", () => {
  it("keeps <video> and <audio> with their playback attributes", () => {
    const html = renderHtml(
      '<video src="https://example.com/clip.mp4" loop muted></video>' +
        '<audio src="https://example.com/memo.mp3" loop></audio>',
    );
    expect(html).toContain("<video");
    expect(html).toContain("<audio");
    expect(html).toContain("loop");
    expect(html).toContain('preload="none"');
  });

  it("strips autoplay so opening a document never starts playback", () => {
    const html = renderHtml('<video src="https://example.com/clip.mp4" autoplay></video>');
    expect(html).toContain("<video");
    expect(html).not.toContain("autoplay");
  });

  it("keeps <source> children and their type", () => {
    const html = renderHtml(
      '<video><source src="https://example.com/clip.webm" type="video/webm"></video>',
    );
    expect(html).toContain("<source");
    expect(html).toContain("video/webm");
  });

  it("drops a poster with a non-http scheme", () => {
    const html = renderHtml(
      '<video src="https://example.com/clip.mp4" poster="file:///c:/users/me/private.png"></video>',
    );
    expect(html).toContain("<video");
    expect(html).not.toContain("file:///");
  });

  it("strips author-supplied preload, which the renderers set themselves", () => {
    const html = renderHtml('<video src="https://example.com/clip.mp4" preload="auto"></video>');
    expect(html).toContain('preload="none"');
    expect(html).not.toContain('preload="auto"');
  });
});
