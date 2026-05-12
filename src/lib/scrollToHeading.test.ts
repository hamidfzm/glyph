import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onActiveHeadingChange, scrollToHeading } from "./scrollToHeading";

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
