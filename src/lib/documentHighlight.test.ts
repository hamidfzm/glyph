import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { locateInDocument } from "./documentHighlight";

const scrollIntoView = vi.fn();

beforeEach(() => {
  Element.prototype.scrollIntoView = scrollIntoView;
  document.body.innerHTML = `
    <div class="markdown-body">
      <h1>Title</h1>
      <p>The quick brown fox jumps over the lazy dog.</p>
      <p>Second   paragraph with  odd   spacing.</p>
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
