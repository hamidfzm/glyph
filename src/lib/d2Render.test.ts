import { beforeEach, describe, expect, it, vi } from "vitest";

const compile = vi.fn();
const renderSvg = vi.fn();
// DOMPurify does not run faithfully under happy-dom (it leaves <script> intact
// and drops the <svg> wrapper), so we can't assert real stripping here — that's
// DOMPurify's own job and works in the Tauri webview's real Chromium. Instead we
// mock it and assert renderD2 routes the rendered SVG through it with the
// foreignObject-forbidding config before returning/caching.
const sanitize = vi.fn((svg: string, _opts?: { FORBID_TAGS?: string[] }) => `CLEAN:${svg}`);

vi.mock("@terrastruct/d2", () => ({
  D2: class {
    compile = (...args: unknown[]) => compile(...args);
    render = (...args: unknown[]) => renderSvg(...args);
  },
}));

vi.mock("dompurify", () => ({
  default: {
    sanitize: (svg: string, opts?: { FORBID_TAGS?: string[] }) => sanitize(svg, opts),
  },
}));

import { renderD2 } from "./d2Render";

describe("renderD2", () => {
  beforeEach(() => {
    compile.mockReset();
    renderSvg.mockReset();
    sanitize.mockClear();
    compile.mockResolvedValue({ diagram: {}, renderOptions: {} });
  });

  it("sanitizes the rendered SVG (forbidding foreignObject) before returning it", async () => {
    renderSvg.mockResolvedValue("<svg><script>x</script></svg>");
    const out = await renderD2("wire-key", false);
    expect(sanitize).toHaveBeenCalledWith("<svg><script>x</script></svg>", {
      FORBID_TAGS: ["foreignObject"],
    });
    expect(out).toBe("CLEAN:<svg><script>x</script></svg>");
  });

  it("serves an unchanged (source, theme) from cache without recompiling", async () => {
    renderSvg.mockResolvedValue("<svg></svg>");
    await renderD2("cache-key", false);
    await renderD2("cache-key", false);
    expect(compile).toHaveBeenCalledTimes(1);
  });

  it("recompiles when the theme changes for the same source", async () => {
    renderSvg.mockResolvedValue("<svg></svg>");
    await renderD2("theme-key", false);
    await renderD2("theme-key", true);
    expect(compile).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failed render, so it can be retried", async () => {
    renderSvg.mockRejectedValueOnce(new Error("boom"));
    renderSvg.mockResolvedValueOnce("<svg></svg>");
    await expect(renderD2("retry-key", false)).rejects.toThrow("boom");
    await expect(renderD2("retry-key", false)).resolves.toBe("CLEAN:<svg></svg>");
    expect(compile).toHaveBeenCalledTimes(2);
  });
});
