import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onActiveHeadingChange, scrollDocumentTo, scrollToHeading } from "./scrollToHeading";

describe("scrollToHeading", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("returns false when the target id is not present", () => {
    expect(scrollToHeading("missing")).toBe(false);
  });

  it("scrolls the matching element into view and returns true", () => {
    const heading = document.createElement("h2");
    heading.id = "intro";
    document.body.appendChild(heading);
    const spy = vi.spyOn(heading, "scrollIntoView").mockImplementation(() => {});

    expect(scrollToHeading("intro")).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    const arg = spy.mock.calls[0][0] as ScrollIntoViewOptions;
    expect(arg.behavior).toBe("smooth");
    expect(["start", "end"]).toContain(arg.block);
  });

  it("scrolls to start when the target fits the scroll container's range", () => {
    const scroller = document.createElement("div");
    scroller.style.overflowY = "auto";
    const heading = document.createElement("h2");
    heading.id = "in-scroller";
    scroller.appendChild(heading);
    document.body.appendChild(scroller);
    const spy = vi.spyOn(heading, "scrollIntoView").mockImplementation(() => {});

    expect(scrollToHeading("in-scroller")).toBe(true);
    const arg = spy.mock.calls[0][0] as ScrollIntoViewOptions;
    expect(arg.block).toBe("start");
  });

  it("scrolls to end when the target sits past the container's max scroll", () => {
    const scroller = document.createElement("div");
    scroller.style.overflowY = "scroll";
    const heading = document.createElement("h2");
    heading.id = "past-end";
    scroller.appendChild(heading);
    document.body.appendChild(scroller);
    const spy = vi.spyOn(heading, "scrollIntoView").mockImplementation(() => {});
    // happy-dom reports zero layout boxes; push the target's top past the
    // container's max scroll (0) so the end branch is taken.
    vi.spyOn(heading, "getBoundingClientRect").mockReturnValue({
      top: 100,
    } as DOMRect);

    expect(scrollToHeading("past-end")).toBe(true);
    const arg = spy.mock.calls[0][0] as ScrollIntoViewOptions;
    expect(arg.block).toBe("end");
  });

  it("dispatches a glyph:active-heading event with the target id", () => {
    const heading = document.createElement("h2");
    heading.id = "section";
    document.body.appendChild(heading);
    vi.spyOn(heading, "scrollIntoView").mockImplementation(() => {});

    const received: string[] = [];
    const unsub = onActiveHeadingChange((id) => received.push(id));
    scrollToHeading("section");
    unsub();

    expect(received).toEqual(["section"]);
  });
});

describe("scrollDocumentTo", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("sets scrollTop on the document scroller", () => {
    const scroller = document.createElement("div");
    scroller.setAttribute("data-scroll-container", "");
    document.body.appendChild(scroller);

    scrollDocumentTo(240);
    expect(scroller.scrollTop).toBe(240);
  });

  it("prefers the rendered pane of a split layout over its source pane", () => {
    const source = document.createElement("div");
    source.setAttribute("data-scroll-container", "");
    const preview = document.createElement("div");
    preview.className = "split-view-preview";
    const rendered = document.createElement("div");
    rendered.setAttribute("data-scroll-container", "");
    preview.appendChild(rendered);
    document.body.append(source, preview);

    scrollDocumentTo(120);
    expect(rendered.scrollTop).toBe(120);
    expect(source.scrollTop).toBe(0);
  });

  it("is a no-op when no document scroller is mounted", () => {
    expect(() => scrollDocumentTo(240)).not.toThrow();
  });
});

describe("onActiveHeadingChange", () => {
  it("returns a cleanup that detaches the listener", () => {
    const handler = vi.fn();
    const unsub = onActiveHeadingChange(handler);
    unsub();
    window.dispatchEvent(new CustomEvent("glyph:active-heading", { detail: { id: "ignored" } }));
    expect(handler).not.toHaveBeenCalled();
  });

  it("ignores events without a detail id", () => {
    const handler = vi.fn();
    const unsub = onActiveHeadingChange(handler);
    window.dispatchEvent(new CustomEvent("glyph:active-heading", { detail: {} }));
    unsub();
    expect(handler).not.toHaveBeenCalled();
  });
});
