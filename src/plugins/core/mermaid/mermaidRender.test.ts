import { beforeEach, describe, expect, it, vi } from "vitest";
import { RENDER_CACHE_LIMIT } from "./renderCache";

const initialize = vi.fn();
const renderSvg = vi.fn();

vi.mock("mermaid", () => ({
  default: {
    initialize: (...args: unknown[]) => initialize(...args),
    render: (...args: unknown[]) => renderSvg(...args),
  },
}));

// DOMPurify does not run faithfully under happy-dom (it drops the <svg>
// wrapper), so mock it as a pass-through that still returns a real fragment,
// and assert the sanitize wiring instead; real stripping is its job in the
// webview.
const sanitizeMock = vi.fn((svg: string, _opts?: Record<string, unknown>) => {
  const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
  const fragment = document.createDocumentFragment();
  if (!parsed.querySelector("parsererror")) fragment.appendChild(parsed.documentElement);
  return fragment;
});
vi.mock("dompurify", () => ({
  default: {
    sanitize: (svg: string, opts?: Record<string, unknown>) => sanitizeMock(svg, opts),
  },
}));

import { renderMermaid, renderMermaidPreview, renderMermaidStatic } from "./mermaidRender";

// The module-level cache survives across tests in this file, so every test
// uses its own distinct source strings (same convention as the D2 plugin's d2Render.test.ts).
describe("renderMermaid", () => {
  beforeEach(() => {
    initialize.mockClear();
    renderSvg.mockReset();
    renderSvg.mockResolvedValue({ svg: "<svg/>" });
  });

  it("serves an unchanged (source, theme) from cache without re-rendering", async () => {
    await renderMermaid("cache-hit", false);
    await renderMermaid("cache-hit", false);
    expect(renderSvg).toHaveBeenCalledTimes(1);
  });

  it("re-renders when the theme changes for the same source", async () => {
    await renderMermaid("theme-key", false);
    await renderMermaid("theme-key", true);
    expect(renderSvg).toHaveBeenCalledTimes(2);
    expect(initialize).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ theme: "default", startOnLoad: false }),
    );
    expect(initialize).toHaveBeenNthCalledWith(2, expect.objectContaining({ theme: "dark" }));
  });

  it("re-renders when the source changes", async () => {
    await renderMermaid("source-a", false);
    await renderMermaid("source-b", false);
    expect(renderSvg).toHaveBeenCalledTimes(2);
  });

  it("passes a fresh id to mermaid.render on every real render", async () => {
    await renderMermaid("fresh-id-a", false);
    await renderMermaid("fresh-id-b", false);
    const ids = renderSvg.mock.calls.map((c) => c[0]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("does not cache a failed render, so the next call retries it", async () => {
    renderSvg.mockRejectedValueOnce(new Error("boom"));
    renderSvg.mockResolvedValueOnce({ svg: "<svg id='retried'/>" });
    await expect(renderMermaid("retry-key", false)).rejects.toThrow("boom");
    await expect(renderMermaid("retry-key", false)).resolves.toBe("<svg id='retried'/>");
    expect(renderSvg).toHaveBeenCalledTimes(2);
  });

  it("shares one render pass between concurrent calls for the same diagram", async () => {
    let resolveRender: (v: { svg: string }) => void = () => {};
    renderSvg.mockImplementationOnce(
      () =>
        new Promise<{ svg: string }>((resolve) => {
          resolveRender = resolve;
        }),
    );
    const first = renderMermaid("concurrent-key", false);
    const second = renderMermaid("concurrent-key", false);
    // The render starts asynchronously (behind the serialization queue), so
    // wait for it before resolving, or the resolver is still the no-op.
    await vi.waitFor(() => expect(renderSvg).toHaveBeenCalledTimes(1));
    resolveRender({ svg: "<svg id='shared'/>" });
    await expect(first).resolves.toBe("<svg id='shared'/>");
    await expect(second).resolves.toBe("<svg id='shared'/>");
    expect(renderSvg).toHaveBeenCalledTimes(1);
  });

  it("serializes initialize+render pairs so themes cannot interleave", async () => {
    let resolveFirst: (v: { svg: string }) => void = () => {};
    renderSvg.mockImplementationOnce(
      () =>
        new Promise<{ svg: string }>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const first = renderMermaid("serial-a", false);
    const second = renderMermaid("serial-b", true);
    await vi.waitFor(() => expect(renderSvg).toHaveBeenCalledTimes(1));
    // The second pair must not start (no initialize, no render) while the
    // first render is still in flight, no matter how many microtasks pass.
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
    }
    expect(renderSvg).toHaveBeenCalledTimes(1);
    expect(initialize).toHaveBeenCalledTimes(1);
    resolveFirst({ svg: "<svg/>" });
    await first;
    await second;
    expect(renderSvg).toHaveBeenCalledTimes(2);
  });

  it("a failed render evicted from the LRU does not delete a newer promise under its key", async () => {
    let rejectFirst: (reason: unknown) => void = () => {};
    renderSvg.mockImplementationOnce(
      () =>
        new Promise<{ svg: string }>((_resolve, reject) => {
          rejectFirst = reject;
        }),
    );
    const first = renderMermaid("w1-dup", false);
    // These synchronous cache.set calls push "w1-dup" out of the LRU while its
    // render is still queued.
    const fillers: Promise<string>[] = [];
    for (let i = 0; i < RENDER_CACHE_LIMIT; i++) {
      fillers.push(renderMermaid(`w1-fill-${i}`, false));
    }
    // Miss (the key was evicted): a second, healthy promise is cached.
    const second = renderMermaid("w1-dup", false);
    await vi.waitFor(() => expect(renderSvg).toHaveBeenCalledTimes(1));
    rejectFirst(new Error("stale failure"));
    await expect(first).rejects.toThrow("stale failure");
    await Promise.all(fillers);
    await expect(second).resolves.toBe("<svg/>");
    const settled = renderSvg.mock.calls.length;
    // The healthy promise must have survived the failed one's eviction.
    await renderMermaid("w1-dup", false);
    expect(renderSvg).toHaveBeenCalledTimes(settled);
  });

  it("evicts the least recently used entry past the cache limit", async () => {
    for (let i = 0; i < RENDER_CACHE_LIMIT; i++) {
      await renderMermaid(`evict-${i}`, false);
    }
    expect(renderSvg).toHaveBeenCalledTimes(RENDER_CACHE_LIMIT);
    // Touch evict-0 so it is the most recently used, then push one past the
    // limit: evict-1 (now oldest) falls out, evict-0 survives.
    await renderMermaid("evict-0", false);
    expect(renderSvg).toHaveBeenCalledTimes(RENDER_CACHE_LIMIT);
    await renderMermaid("evict-overflow", false);
    await renderMermaid("evict-0", false);
    expect(renderSvg).toHaveBeenCalledTimes(RENDER_CACHE_LIMIT + 1);
    await renderMermaid("evict-1", false);
    expect(renderSvg).toHaveBeenCalledTimes(RENDER_CACHE_LIMIT + 2);
  });
});

describe("renderMermaidStatic", () => {
  beforeEach(() => {
    initialize.mockReset();
    renderSvg.mockReset();
  });

  it("re-renders light with SVG text labels and returns the markup", async () => {
    renderSvg.mockResolvedValue({ svg: "<svg data-light='1'></svg>" });
    // Re-serialized (the label-background pass parses it), so assert on content.
    const svg = await renderMermaidStatic("graph TD; A-->B");
    expect(svg).toContain('data-light="1"');
    // The top-level flag matters: with only the flowchart one, Mermaid v11 still
    // emits <foreignObject> node labels and they vanish from the PDF.
    expect(initialize).toHaveBeenCalledWith({
      startOnLoad: false,
      theme: "default",
      htmlLabels: false,
      flowchart: { htmlLabels: false },
    });
  });

  it("leaves no export options behind for the next screen render", async () => {
    renderSvg.mockResolvedValue({ svg: "<svg/>" });
    await renderMermaidStatic("graph TD; A-->B");
    await renderMermaid("after-static", false);
    // Relies on Mermaid 11's initialize resetting to its defaults first, so
    // passing no htmlLabels flag here brings HTML labels back on screen.
    expect(initialize).toHaveBeenLastCalledWith({ startOnLoad: false, theme: "default" });
  });

  it("sanitizes the rendered markup before any consumer sees it", async () => {
    renderSvg.mockResolvedValue({ svg: '<svg xmlns="http://www.w3.org/2000/svg"/>' });
    await renderMermaidStatic("graph TD; A-->B");
    expect(sanitizeMock.mock.calls[0][1]).toMatchObject({ FORBID_TAGS: ["foreignObject"] });
  });

  it("clears the filled backdrop Mermaid puts behind edge and cluster labels", async () => {
    renderSvg.mockResolvedValue({
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><g class="edgeLabel"><rect class="background" style="stroke: none"/></g></svg>',
    });
    const svg = await renderMermaidStatic("graph TD; A-->|x|B");
    expect(svg).toMatch(/fill:\s*none/);
    // The existing inline declarations survive.
    expect(svg).toMatch(/stroke:\s*none/);
  });

  it("rejects when sanitizing leaves no svg behind", async () => {
    renderSvg.mockResolvedValue({ svg: "<svg><unclosed></svg>" });
    await expect(renderMermaidStatic("graph TD; A-->B")).rejects.toThrow("no svg");
  });

  it("passes a fresh id per render (Mermaid keeps state per id)", async () => {
    renderSvg.mockResolvedValue({ svg: "<svg/>" });
    await renderMermaidStatic("graph TD; A-->B");
    await renderMermaidStatic("graph TD; A-->B");
    const ids = renderSvg.mock.calls.map((c) => c[0]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("renderMermaidPreview", () => {
  beforeEach(() => {
    initialize.mockReset();
    renderSvg.mockReset();
  });

  it("renders in the given theme with SVG text labels, sanitized", async () => {
    renderSvg.mockResolvedValue({ svg: '<svg xmlns="http://www.w3.org/2000/svg"/>' });
    sanitizeMock.mockClear();
    await renderMermaidPreview("graph TD; A-->B", true);
    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({ theme: "dark", htmlLabels: false }),
    );
    expect(sanitizeMock.mock.calls[0][1]).toMatchObject({ FORBID_TAGS: ["foreignObject"] });
  });

  it("keeps the label backgrounds, which only paper drops", async () => {
    renderSvg.mockResolvedValue({
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect class="background" style="stroke: none"/></svg>',
    });
    const svg = await renderMermaidPreview("graph TD; A-->|x|B", false);
    expect(svg).not.toMatch(/fill:\s*none/);
  });
});
