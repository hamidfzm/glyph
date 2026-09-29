import { afterEach, describe, expect, it, vi } from "vitest";
import { staticRenderers } from "@/lib/plugins/staticRenderers";
import { swapDiagramsLight } from "./lightDiagrams";

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
    try {
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
    } finally {
      dispose();
    }
  });

  it("re-renders a plugin block that carries no source as empty source", async () => {
    const renderStatic = vi.fn(async () => "<svg></svg>");
    const dispose = staticRenderers.register({ language: "puml", renderStatic });
    try {
      setBody('<div data-fenced-language="puml"><div>dark</div></div>');
      await swapDiagramsLight(document);
      expect(renderStatic).toHaveBeenCalledWith("");
    } finally {
      dispose();
    }
  });

  it("leaves a plugin block alone when its static render fails", async () => {
    const dispose = staticRenderers.register({
      language: "puml",
      renderStatic: async () => {
        throw new Error("bad source");
      },
    });
    try {
      setBody(
        '<div data-fenced-language="puml" data-fenced-source="a"><div id="live">dark</div></div>',
      );
      await swapDiagramsLight(document);
      expect(document.getElementById("live")?.style.display).toBe("");
    } finally {
      dispose();
    }
  });

  it("sanitizes a plugin's static render before it re-enters the DOM", async () => {
    // Third-party markup, straight into the live document ahead of printing.
    const dispose = staticRenderers.register({
      language: "puml",
      renderStatic: async () => '<svg onload="alert(1)"></svg>',
    });
    try {
      setBody('<div data-fenced-language="puml" data-fenced-source="a"><div>dark</div></div>');
      await swapDiagramsLight(document);
      expect(sanitizeMock).toHaveBeenCalledTimes(1);
      expect(sanitizeMock.mock.calls[0][0]).toContain("onload");
      expect(sanitizeMock.mock.calls[0][1]).toEqual({ FORBID_TAGS: ["foreignObject"] });
    } finally {
      dispose();
    }
  });
});
