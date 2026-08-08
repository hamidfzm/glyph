import { afterEach, describe, expect, it, vi } from "vitest";
import { swapDiagramsLight } from "./lightDiagrams";

const renderMermaidMock = vi.fn(async () => '<svg data-diagram="mermaid-light"></svg>');
const renderD2Mock = vi.fn(async () => '<svg data-diagram="d2-light"></svg>');
const restoreMermaidMock = vi.fn(async (_dark: boolean) => {});
vi.mock("./rasterize", () => ({
  renderMermaidLightSvg: () => renderMermaidMock(),
  restoreMermaidTheme: (dark: boolean) => restoreMermaidMock(dark),
}));
vi.mock("@/lib/d2Render", () => ({
  renderD2: () => renderD2Mock(),
}));
// DOMPurify does not run faithfully under happy-dom (it drops the <svg>
// wrapper), so mock it pass-through; real stripping is its job in the webview.
const sanitizeMock = vi.fn((svg: string, _opts?: { FORBID_TAGS?: string[] }) => svg);
vi.mock("dompurify", () => ({
  default: {
    sanitize: (svg: string, opts?: { FORBID_TAGS?: string[] }) => sanitizeMock(svg, opts),
  },
}));

function setBody(html: string): void {
  document.body.innerHTML = html;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("swapDiagramsLight", () => {
  it("replaces Mermaid and D2 diagrams with their light renders", async () => {
    setBody(
      '<div class="mermaid-diagram" data-mermaid-source="graph TD; A-->B"><svg data-dark="1"></svg></div>' +
        '<div class="d2-diagram" data-d2-source="a -> b"><svg data-dark="1"></svg></div>',
    );
    await swapDiagramsLight(document);
    expect(document.body.innerHTML).toContain('data-diagram="mermaid-light"');
    expect(document.body.innerHTML).toContain('data-diagram="d2-light"');
    expect(document.body.innerHTML).not.toContain('data-dark="1"');
    // Mermaid's global config is left on the app (dark) theme.
    expect(restoreMermaidMock).toHaveBeenCalledWith(true);
  });

  it("restores the original markup when the returned callback runs", async () => {
    setBody('<div class="mermaid-diagram" data-mermaid-source="graph TD; A-->B"><svg/></div>');
    const restore = await swapDiagramsLight(document);
    expect(document.body.innerHTML).toContain('data-diagram="mermaid-light"');
    restore();
    expect(document.body.innerHTML).not.toContain('data-diagram="mermaid-light"');
  });

  it("keeps the on-screen diagram when the light render fails", async () => {
    renderMermaidMock.mockRejectedValueOnce(new Error("bad source"));
    setBody(
      '<div class="mermaid-diagram" data-mermaid-source="broken"><svg data-dark="1"></svg></div>',
    );
    await swapDiagramsLight(document);
    expect(document.body.innerHTML).toContain('data-dark="1"');
  });

  it("skips a diagram with no source and never touches Mermaid's config", async () => {
    setBody('<div class="mermaid-diagram"><svg data-dark="1"></svg></div>');
    await swapDiagramsLight(document);
    expect(renderMermaidMock).not.toHaveBeenCalled();
    expect(restoreMermaidMock).not.toHaveBeenCalled();
    expect(document.body.innerHTML).toContain('data-dark="1"');
  });

  it("sanitizes the re-rendered SVG before it re-enters the DOM", async () => {
    setBody('<div class="mermaid-diagram" data-mermaid-source="graph TD; A-->B"><svg/></div>');
    await swapDiagramsLight(document);
    expect(sanitizeMock).toHaveBeenCalledTimes(1);
    expect(sanitizeMock.mock.calls[0][1]).toEqual({ FORBID_TAGS: ["foreignObject"] });
  });
});
