import { act, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Disposer } from "@/lib/plugins/disposer";
import type { FencedRendererProps } from "@/lib/plugins/types";
import { createD2Renderer } from "./createD2Renderer";

const renderD2 = vi.hoisted(() => vi.fn());
vi.mock("./d2Render", () => ({ renderD2 }));

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

function mount(props: FencedRendererProps): HTMLElement {
  const el = document.createElement("div");
  document.body.append(el);
  createD2Renderer(i18n).mount(el, props, (cleanup) => cleanups.push(cleanup));
  return el;
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
  renderD2.mockReset();
  languageListeners = [];
});

afterEach(() => {
  unmount();
  document.body.innerHTML = "";
  document.documentElement.classList.remove("dark");
});

describe("createD2Renderer", () => {
  it("renders the SVG in the light theme and clears aria-busy once it is in", async () => {
    const pending = deferred();
    renderD2.mockReturnValue(pending.promise);
    const el = mount({ code: "x -> y" });

    const diagram = el.querySelector(".d2-diagram");
    expect(diagram?.getAttribute("aria-busy")).toBe("true");
    expect(renderD2).toHaveBeenCalledWith("x -> y", false);

    await act(async () => pending.resolve("<svg data-test='d'></svg>"));
    expect(el.querySelector(".d2-diagram svg")?.getAttribute("data-test")).toBe("d");
    expect(diagram?.getAttribute("aria-busy")).toBe("false");
  });

  it("renders in the dark theme when the app is dark", () => {
    document.documentElement.classList.add("dark");
    renderD2.mockResolvedValue("<svg></svg>");
    mount({ code: "x -> y" });
    expect(renderD2).toHaveBeenCalledWith("x -> y", true);
  });

  it("shows the failure with the source as text when the render rejects", async () => {
    renderD2.mockRejectedValue(new Error("bad d2"));
    const el = mount({ code: "<b>garbage</b>" });

    await waitFor(() => expect(el.querySelector(".d2-error")).not.toBeNull());
    expect(el.querySelector(".d2-error-label")?.textContent).toBe("t(glyph.core.d2:errorTitle)");
    expect(el.querySelector("pre code")?.textContent).toBe("<b>garbage</b>");
    expect(el.querySelector("b")).toBeNull();
    expect(el.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it("flags empty source without calling the renderer", () => {
    const el = mount({ code: "  \n\t " });
    expect(el.querySelector(".d2-error")).not.toBeNull();
    expect(renderD2).not.toHaveBeenCalled();
  });

  it("re-renders on a theme flip and drops the stale earlier render", async () => {
    const first = deferred();
    renderD2.mockReturnValueOnce(first.promise).mockResolvedValueOnce("<svg id='winner'></svg>");
    const el = mount({ code: "x -> y" });

    document.documentElement.classList.add("dark");
    await waitFor(() => expect(el.querySelector("svg#winner")).not.toBeNull());
    expect(renderD2).toHaveBeenLastCalledWith("x -> y", true);

    await act(async () => first.resolve("<svg id='stale'></svg>"));
    expect(el.querySelector("svg#stale")).toBeNull();
    expect(el.querySelector("svg#winner")).not.toBeNull();
  });

  it("ignores class changes that keep the theme", async () => {
    renderD2.mockResolvedValue("<svg></svg>");
    mount({ code: "x -> y" });
    document.documentElement.classList.add("unrelated");
    await act(() => Promise.resolve());
    expect(renderD2).toHaveBeenCalledTimes(1);
    document.documentElement.classList.remove("unrelated");
  });

  it("does not flip into the failure when a stale render rejects after a newer one wins", async () => {
    const first = deferred();
    renderD2.mockReturnValueOnce(first.promise).mockResolvedValueOnce("<svg id='winner'></svg>");
    const el = mount({ code: "x -> y" });

    document.documentElement.classList.add("dark");
    await waitFor(() => expect(el.querySelector("svg#winner")).not.toBeNull());

    await act(async () => first.reject(new Error("stale failure")));
    expect(el.querySelector(".d2-error")).toBeNull();
  });

  it("stops writing and watching the theme once cleaned up", async () => {
    const pending = deferred();
    renderD2.mockReturnValue(pending.promise);
    const el = mount({ code: "x -> y" });

    unmount();
    await act(async () => pending.resolve("<svg id='late'></svg>"));
    expect(el.querySelector("svg#late")).toBeNull();

    document.documentElement.classList.add("dark");
    await act(() => Promise.resolve());
    expect(renderD2).toHaveBeenCalledTimes(1);
  });

  it("refreshes its labels when the app language changes", () => {
    renderD2.mockReturnValue(new Promise(() => {}));
    let suffix = "";
    const translate = vi.spyOn(i18n, "t").mockImplementation((key) => `${key}${suffix}`);
    const el = mount({ code: "x -> y", openLightbox: vi.fn() });

    suffix = " (fa)";
    for (const listener of languageListeners) listener();
    expect(el.querySelector(".d2-diagram")?.getAttribute("aria-label")).toBe(
      "glyph.core.d2:label (fa)",
    );
    translate.mockRestore();
  });

  describe("lightbox zoom", () => {
    it("is a zoomable button that opens the rendered SVG with its xmlns on click", async () => {
      renderD2.mockResolvedValue("<svg id='zoomed'></svg>");
      const openLightbox = vi.fn();
      const el = mount({ code: "x -> y", openLightbox });
      const diagram = el.querySelector(".d2-diagram") as HTMLElement;
      await waitFor(() => expect(diagram.getAttribute("aria-busy")).toBe("false"));

      expect(diagram.getAttribute("role")).toBe("button");
      expect(diagram.tabIndex).toBe(0);
      fireEvent.click(diagram);

      expect(openLightbox).toHaveBeenCalledTimes(1);
      const [src, label] = openLightbox.mock.calls[0];
      expect(src).toMatch(/^data:image\/svg\+xml,/);
      expect(decodeURIComponent(src)).toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(label).toBe("t(glyph.core.d2:label)");
    });

    it("opens on Enter and Space but not other keys, and not before the SVG is in", async () => {
      const pending = deferred();
      renderD2.mockReturnValue(pending.promise);
      const openLightbox = vi.fn();
      const el = mount({ code: "x -> y", openLightbox });
      const diagram = el.querySelector(".d2-diagram") as HTMLElement;

      fireEvent.click(diagram);
      expect(openLightbox).not.toHaveBeenCalled();

      await act(async () => pending.resolve("<svg></svg>"));
      fireEvent.keyDown(diagram, { key: "Enter" });
      fireEvent.keyDown(diagram, { key: " " });
      fireEvent.keyDown(diagram, { key: "a" });
      expect(openLightbox).toHaveBeenCalledTimes(2);
    });

    it("is not a button when the host offers no lightbox", () => {
      renderD2.mockResolvedValue("<svg></svg>");
      const el = mount({ code: "x -> y" });
      const diagram = el.querySelector(".d2-diagram");
      expect(diagram?.getAttribute("role")).toBeNull();
      expect(diagram?.getAttribute("aria-label")).toBeNull();
    });
  });
});
