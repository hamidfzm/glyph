import { afterEach, describe, expect, it, vi } from "vitest";
import { staticRenderers } from "@/lib/plugins/staticRenderers";
import { swapDiagramsLight } from "./lightDiagrams";

const renderMermaidMock = vi.fn(async () => '<svg data-diagram="mermaid-light"></svg>');
const restoreMermaidMock = vi.fn(async (_dark: boolean) => {});
vi.mock("./rasterize", () => ({
  renderMermaidLightSvg: () => renderMermaidMock(),
  restoreMermaidTheme: (dark: boolean) => restoreMermaidMock(dark),
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
  it("shows a plugin block's static render beside the hidden live one, then restores it", async () => {
    const dispose = staticRenderers.register({
      language: "puml",
      renderStatic: async (code) => `<svg data-light="${code}"></svg>`,
    });
    setBody(
      '<div data-fenced-language="puml" data-fenced-source="a"><div id="live">dark</div></div>' +
        '<div data-fenced-language="unknown" data-fenced-source="b"><div id="other">keep</div></div>',
    );

    const restore = await swapDiagramsLight(document);
    expect(document.body.innerHTML).toContain('data-light="a"');
    expect(document.getElementById("live")?.style.display).toBe("none");
    expect(document.getElementById("other")?.style.display).toBe("");

    restore();
    expect(document.body.innerHTML).not.toContain("data-light");
    expect(document.getElementById("live")?.style.display).toBe("");
    dispose();
  });

  it("leaves a plugin block alone when its static render fails", async () => {
    const dispose = staticRenderers.register({
      language: "puml",
      renderStatic: async () => {
        throw new Error("bad source");
      },
    });
    setBody(
      '<div data-fenced-language="puml" data-fenced-source="a"><div id="live">dark</div></div>',
    );

    await swapDiagramsLight(document);
    expect(document.getElementById("live")?.style.display).toBe("");
    dispose();
  });

  it("replaces Mermaid diagrams with their light renders", async () => {
    setBody(
      '<div class="mermaid-diagram" data-mermaid-source="graph TD; A-->B"><svg data-dark="1"></svg></div>',
    );
    await swapDiagramsLight(document);
    expect(document.body.innerHTML).toContain('data-diagram="mermaid-light"');
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
