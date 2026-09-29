import { act, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Disposer, FencedRendererProps } from "@/lib/plugins/types";
import { createMermaidRenderer } from "./createMermaidRenderer";

const renderMermaid = vi.hoisted(() => vi.fn());
vi.mock("./mermaidRender", () => ({ renderMermaid }));

let languageListeners: Array<() => void> = [];
const i18n = {
  t: (key: string) => `t(${key})`,
  onLanguageChange(listener: () => void): Disposer {
    languageListeners.push(listener);
    return () => {
      languageListeners = languageListeners.filter((l) => l !== listener);
    };
  },
};

const cleanups: Disposer[] = [];

function mountInto(el: HTMLElement, props: FencedRendererProps): HTMLElement {
  createMermaidRenderer(i18n).mount(el, props, (cleanup) => cleanups.push(cleanup));
  return el;
}

function mount(props: FencedRendererProps): HTMLElement {
  const el = document.createElement("div");
  document.body.append(el);
  return mountInto(el, props);
}

function unmount(): void {
  for (const cleanup of cleanups.splice(0)) cleanup();
}

function deferred() {
  let resolve: (svg: string) => void = () => {};
  let reject: (err: unknown) => void = () => {};
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  renderMermaid.mockReset();
  languageListeners = [];
});

afterEach(() => {
  unmount();
  document.body.innerHTML = "";
  document.documentElement.classList.remove("dark");
});

describe("createMermaidRenderer", () => {
  it("renders the SVG in the light theme, busy until it is in", async () => {
    const pending = deferred();
    renderMermaid.mockReturnValue(pending.promise);
    const el = mount({ code: "graph TD; A-->B" });

    expect(el.getAttribute("aria-busy")).toBe("true");
    expect(renderMermaid).toHaveBeenCalledWith("graph TD; A-->B", false);

    await act(async () => pending.resolve("<svg data-test='d'></svg>"));
    expect(el.querySelector(".mermaid-diagram svg")?.getAttribute("data-test")).toBe("d");
    expect(el.getAttribute("aria-busy")).toBe("false");
  });

  it("renders in the dark theme when the app is dark", () => {
    document.documentElement.classList.add("dark");
    renderMermaid.mockResolvedValue("<svg></svg>");
    mount({ code: "graph TD; A-->B" });
    expect(renderMermaid).toHaveBeenCalledWith("graph TD; A-->B", true);
  });

  it("keeps the previous diagram on screen while a remount's render is pending", async () => {
    renderMermaid.mockResolvedValueOnce("<svg id='first'></svg>");
    const el = mount({ code: "graph TD; A-->B" });
    await waitFor(() => expect(el.querySelector("svg#first")).not.toBeNull());

    // The host remounts over the same element when the source changes.
    unmount();
    const pending = deferred();
    renderMermaid.mockReturnValueOnce(pending.promise);
    mountInto(el, { code: "graph TD; A-->C" });
    expect(el.querySelector("svg#first")).not.toBeNull();
    expect(el.getAttribute("aria-busy")).toBe("true");

    await act(async () => pending.resolve("<svg id='second'></svg>"));
    expect(el.querySelector("svg#first")).toBeNull();
    expect(el.querySelector("svg#second")).not.toBeNull();
  });

  it("shows the failure with the source as text when the render rejects", async () => {
    renderMermaid.mockRejectedValue(new Error("bad mermaid"));
    const el = mount({ code: "<b>garbage</b>" });

    await waitFor(() => expect(el.querySelector(".mermaid-error")).not.toBeNull());
    expect(el.querySelector(".mermaid-error-label")?.textContent).toBe(
      "t(glyph.core.mermaid:errorTitle)",
    );
    expect(el.querySelector("pre code")?.textContent).toBe("<b>garbage</b>");
    expect(el.querySelector("b")).toBeNull();
    expect(el.getAttribute("aria-busy")).toBe("false");
  });

  it("flags empty source without calling the renderer", () => {
    const el = mount({ code: "  \n\t " });
    expect(el.querySelector(".mermaid-error")).not.toBeNull();
    expect(renderMermaid).not.toHaveBeenCalled();
  });

  it("re-renders on a theme flip and drops the stale earlier render", async () => {
    const first = deferred();
    renderMermaid
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce("<svg id='winner'></svg>");
    const el = mount({ code: "graph TD; A-->B" });

    document.documentElement.classList.add("dark");
    await waitFor(() => expect(el.querySelector("svg#winner")).not.toBeNull());
    expect(renderMermaid).toHaveBeenLastCalledWith("graph TD; A-->B", true);

    await act(async () => first.resolve("<svg id='stale'></svg>"));
    expect(el.querySelector("svg#stale")).toBeNull();
    expect(el.querySelector("svg#winner")).not.toBeNull();
  });

  it("ignores class changes that keep the theme", async () => {
    renderMermaid.mockResolvedValue("<svg></svg>");
    mount({ code: "graph TD; A-->B" });
    document.documentElement.classList.add("unrelated");
    await act(() => Promise.resolve());
    expect(renderMermaid).toHaveBeenCalledTimes(1);
    document.documentElement.classList.remove("unrelated");
  });

  it("does not flip into the failure when a stale render rejects after a newer one wins", async () => {
    const first = deferred();
    renderMermaid
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce("<svg id='winner'></svg>");
    const el = mount({ code: "graph TD; A-->B" });

    document.documentElement.classList.add("dark");
    await waitFor(() => expect(el.querySelector("svg#winner")).not.toBeNull());

    await act(async () => first.reject(new Error("stale failure")));
    expect(el.querySelector(".mermaid-error")).toBeNull();
  });

  it("stops writing, watching the theme, and holding export once cleaned up", async () => {
    const pending = deferred();
    renderMermaid.mockReturnValue(pending.promise);
    const el = mount({ code: "graph TD; A-->B" });

    unmount();
    expect(el.hasAttribute("aria-busy")).toBe(false);
    await act(async () => pending.resolve("<svg id='late'></svg>"));
    expect(el.querySelector("svg#late")).toBeNull();

    document.documentElement.classList.add("dark");
    await act(() => Promise.resolve());
    expect(renderMermaid).toHaveBeenCalledTimes(1);
  });

  it("refreshes its labels when the app language changes", async () => {
    renderMermaid.mockResolvedValue("<svg></svg>");
    let suffix = "";
    const translate = vi.spyOn(i18n, "t").mockImplementation((key) => `${key}${suffix}`);
    try {
      const el = mount({ code: "graph TD; A-->B", openLightbox: vi.fn() });
      await waitFor(() => expect(el.querySelector(".mermaid-diagram")).not.toBeNull());

      suffix = " (fa)";
      for (const listener of languageListeners) listener();
      expect(el.querySelector(".mermaid-diagram")?.getAttribute("aria-label")).toBe(
        "glyph.core.mermaid:label (fa)",
      );
    } finally {
      translate.mockRestore();
    }
  });

  describe("lightbox zoom", () => {
    it("is a zoomable button that opens the rendered SVG with its xmlns on click", async () => {
      renderMermaid.mockResolvedValue("<svg id='zoomed'></svg>");
      const openLightbox = vi.fn();
      const el = mount({ code: "graph TD; A-->B", openLightbox });
      await waitFor(() => expect(el.querySelector(".mermaid-diagram")).not.toBeNull());
      const diagram = el.querySelector(".mermaid-diagram") as HTMLElement;

      expect(diagram.getAttribute("role")).toBe("button");
      expect(diagram.tabIndex).toBe(0);
      fireEvent.click(diagram);

      expect(openLightbox).toHaveBeenCalledTimes(1);
      const [src, label] = openLightbox.mock.calls[0];
      expect(src).toMatch(/^data:image\/svg\+xml,/);
      expect(decodeURIComponent(src)).toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(label).toBe("t(glyph.core.mermaid:label)");
    });

    it("opens on Enter and Space but not other keys", async () => {
      renderMermaid.mockResolvedValue("<svg></svg>");
      const openLightbox = vi.fn();
      const el = mount({ code: "graph TD; A-->B", openLightbox });
      await waitFor(() => expect(el.querySelector(".mermaid-diagram")).not.toBeNull());
      const diagram = el.querySelector(".mermaid-diagram") as HTMLElement;

      fireEvent.keyDown(diagram, { key: "Enter" });
      fireEvent.keyDown(diagram, { key: " " });
      fireEvent.keyDown(diagram, { key: "a" });
      expect(openLightbox).toHaveBeenCalledTimes(2);
    });

    it("is not a button when the host offers no lightbox", async () => {
      renderMermaid.mockResolvedValue("<svg></svg>");
      const el = mount({ code: "graph TD; A-->B" });
      await waitFor(() => expect(el.querySelector(".mermaid-diagram")).not.toBeNull());
      const diagram = el.querySelector(".mermaid-diagram");
      expect(diagram?.getAttribute("role")).toBeNull();
      expect(diagram?.getAttribute("aria-label")).toBeNull();
    });
  });
});
