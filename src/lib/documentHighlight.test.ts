import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { locateInDocument, locateLineInDocument, locateWhenRendered } from "./documentHighlight";

const scrollIntoView = vi.fn();

beforeEach(() => {
  Element.prototype.scrollIntoView = scrollIntoView;
  document.body.innerHTML = `
    <div data-scroll-container>
      <div class="markdown-body">
        <h1 data-line="1">Title</h1>
        <p data-line="3">The quick brown fox jumps over the lazy dog.</p>
        <p data-line="7">Second   paragraph with  odd   spacing.</p>
      </div>
    </div>`;
});

afterEach(() => {
  scrollIntoView.mockReset();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("locateInDocument", () => {
  it("scrolls to and flashes the block containing the text", () => {
    expect(locateInDocument("quick brown fox")).toBe(true);
    const block = document.querySelector("p");
    expect(block?.classList.contains("ai-flash")).toBe(true);
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("matches case- and whitespace-insensitively", () => {
    expect(locateInDocument("SECOND paragraph WITH odd spacing")).toBe(true);
    expect(document.querySelectorAll("p")[1].classList.contains("ai-flash")).toBe(true);
  });

  it("falls back to the opening chunk when the model reworded the quote's tail", () => {
    // First 60+ chars match the second paragraph; the tail is fabricated.
    const quote = `Second paragraph with odd spacing. It goes on and on with more words here, but the model made this part up.`;
    document.querySelectorAll("p")[1].textContent =
      "Second paragraph with odd spacing. It goes on and on with more words here, in the real document.";
    expect(locateInDocument(quote)).toBe(true);
    expect(document.querySelectorAll("p")[1].classList.contains("ai-flash")).toBe(true);
  });

  it("returns false when the text is not in the document", () => {
    expect(locateInDocument("not in the document at all")).toBe(false);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("returns false for empty text or a missing viewer", () => {
    expect(locateInDocument("   ")).toBe(false);
    document.body.innerHTML = "";
    expect(locateInDocument("quick brown fox")).toBe(false);
  });

  it("ignores a markdown-body outside the document scroller", () => {
    // AI replies render .markdown-body too; only the viewer's pane counts.
    document.body.innerHTML = `
      <div class="markdown-body"><p>quick brown fox in a chat reply</p></div>`;
    expect(locateInDocument("quick brown fox")).toBe(false);
  });

  it("prefers the split-view preview pane", () => {
    document.body.innerHTML = `
      <div data-scroll-container>
        <div class="markdown-body"><p>quick brown fox plain</p></div>
      </div>
      <div class="split-view-preview">
        <div data-scroll-container>
          <div class="markdown-body"><p>quick brown fox preview</p></div>
        </div>
      </div>`;
    expect(locateInDocument("quick brown fox")).toBe(true);
    const flashed = document.querySelector(".ai-flash");
    expect(flashed?.textContent).toContain("preview");
  });

  it("skips blocks whose textContent is null", () => {
    const first = document.querySelector("h1") as HTMLElement;
    Object.defineProperty(first, "textContent", { get: () => null });
    expect(locateInDocument("quick brown fox")).toBe(true);
    expect(document.querySelector("p")?.classList.contains("ai-flash")).toBe(true);
  });

  it("clears the previous flash when locating a second passage", () => {
    expect(locateInDocument("quick brown fox")).toBe(true);
    expect(locateInDocument("Second paragraph")).toBe(true);
    const paragraphs = document.querySelectorAll("p");
    expect(paragraphs[0].classList.contains("ai-flash")).toBe(false);
    expect(paragraphs[1].classList.contains("ai-flash")).toBe(true);
  });

  it("removes the flash class after the animation window", () => {
    vi.useFakeTimers();
    locateInDocument("quick brown fox");
    const block = document.querySelector("p");
    expect(block?.classList.contains("ai-flash")).toBe(true);
    vi.advanceTimersByTime(3000);
    expect(block?.classList.contains("ai-flash")).toBe(false);
  });
});

describe("locateLineInDocument", () => {
  it("flashes the last marked block at or above the line", () => {
    expect(locateLineInDocument(5, "unrelated")).toBe(true);
    expect(document.querySelectorAll("p")[0].classList.contains("ai-flash")).toBe(true);
  });

  it("lands on an exact marker", () => {
    expect(locateLineInDocument(7, "unrelated")).toBe(true);
    expect(document.querySelectorAll("p")[1].classList.contains("ai-flash")).toBe(true);
  });

  it("falls back to a text match when the pane has no markers", () => {
    for (const el of document.querySelectorAll("[data-line]")) el.removeAttribute("data-line");
    expect(locateLineInDocument(7, "odd spacing")).toBe(true);
    expect(document.querySelectorAll("p")[1].classList.contains("ai-flash")).toBe(true);
  });

  it("returns false when nothing locates", () => {
    for (const el of document.querySelectorAll("[data-line]")) el.removeAttribute("data-line");
    expect(locateLineInDocument(7, "not in the document at all")).toBe(false);
  });

  it("returns false without a viewer", () => {
    document.body.innerHTML = "";
    expect(locateLineInDocument(1, "anything")).toBe(false);
  });
});

describe("locateWhenRendered", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retries until the locate succeeds, then re-asserts the jump", () => {
    const locate = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    locateWhenRendered(locate);
    vi.advanceTimersByTime(200);
    // One failed tick, one success, one re-assert after the rAF pair.
    expect(locate).toHaveBeenCalledTimes(3);
  });

  it("reports failure after the attempts run out", () => {
    const locate = vi.fn().mockReturnValue(false);
    const onFail = vi.fn();
    locateWhenRendered(locate, onFail);
    vi.advanceTimersByTime(2000);
    expect(locate).toHaveBeenCalledTimes(20);
    expect(onFail).toHaveBeenCalledTimes(1);
  });

  it("skips the re-assert when cancelled between the success and its rAF pair", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    const locate = vi.fn().mockReturnValue(true);
    const cancel = locateWhenRendered(locate);
    vi.advanceTimersByTime(50);
    expect(locate).toHaveBeenCalledTimes(1);

    cancel();
    while (frames.length > 0) frames.shift()?.(0);
    expect(locate).toHaveBeenCalledTimes(1);
  });

  it("stops retrying once cancelled", () => {
    const locate = vi.fn().mockReturnValue(false);
    const onFail = vi.fn();
    const cancel = locateWhenRendered(locate, onFail);
    vi.advanceTimersByTime(120);
    cancel();
    vi.advanceTimersByTime(2000);
    expect(locate).toHaveBeenCalledTimes(2);
    expect(onFail).not.toHaveBeenCalled();
  });
});
