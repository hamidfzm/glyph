import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleDocumentClick } from "./linkClicks";

let root: HTMLElement;
let open: ReturnType<typeof vi.fn>;

// The viewer's own root is `<main id="preview">`, which a heading slugged
// "preview" would otherwise collide with.
function mount(html: string): HTMLElement {
  root = document.createElement("main");
  root.id = "preview";
  root.innerHTML = html;
  root.addEventListener("click", (event) => handleDocumentClick(event, root));
  document.body.append(root);
  return root;
}

function click(target: Element): MouseEvent {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

function scrollSpy(element: Element) {
  return vi.spyOn(element, "scrollIntoView").mockImplementation(() => {});
}

beforeEach(() => {
  open = vi.fn();
  vi.stubGlobal("open", open);
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("handleDocumentClick", () => {
  it("scrolls to an in-document heading without following the link", () => {
    mount('<a href="#intro">Jump</a><h2 id="intro">Intro</h2>');
    const scroll = scrollSpy(root.querySelector("h2")!);
    expect(click(root.querySelector("a")!).defaultPrevented).toBe(true);
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it("finds the document's heading, not the page root sharing its id", () => {
    mount('<a href="#preview">Jump</a><h2 id="preview">Preview</h2>');
    const heading = scrollSpy(root.querySelector("h2")!);
    const pageRoot = scrollSpy(root);
    click(root.querySelector("a")!);
    expect(heading).toHaveBeenCalledTimes(1);
    expect(pageRoot).not.toHaveBeenCalled();
  });

  it("decodes a percent-encoded target to match a heading's raw id", () => {
    mount('<a href="#caf%C3%A9">Jump</a><h2 id="café">Café</h2>');
    const scroll = scrollSpy(root.querySelector("h2")!);
    click(root.querySelector("a")!);
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it("falls back to the raw target when it is not valid percent-encoding", () => {
    mount('<a href="#100%">Jump</a><h2 id="100%">Full</h2>');
    const scroll = scrollSpy(root.querySelector("h2")!);
    click(root.querySelector("a")!);
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it("follows a footnote reference to its note", () => {
    mount(
      '<sup><a href="#user-content-fn-1" id="user-content-fnref-1">1</a></sup>' +
        '<li id="user-content-fn-1">Note</li>',
    );
    const scroll = scrollSpy(root.querySelector("li")!);
    click(root.querySelector("a")!);
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it("keeps a link to a missing anchor, or a bare #, from touching the URL", () => {
    mount('<a href="#nowhere">Missing</a><a href="#" class="wikilink--broken">Broken</a>');
    for (const link of root.querySelectorAll("a")) {
      expect(click(link).defaultPrevented).toBe(true);
    }
    expect(open).not.toHaveBeenCalled();
  });

  it("opens a web link in a new tab with no opener or referrer", () => {
    mount('<a href="https://example.com/page">Out</a>');
    expect(click(root.querySelector("a")!).defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledWith("https://example.com/page", "_blank", "noopener,noreferrer");
  });

  it("treats a protocol-relative link as a web link", () => {
    mount('<a href="//example.com/x">Out</a>');
    click(root.querySelector("a")!);
    expect(open).toHaveBeenCalledWith(
      expect.stringMatching(/^https?:\/\/example\.com\/x$/),
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("opens a link inside an SVG", () => {
    mount('<svg><a xlink:href="https://example.com/node"><text>Node</text></a></svg>');
    expect(click(root.querySelector("text")!).defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledWith("https://example.com/node", "_blank", "noopener,noreferrer");
  });

  it("ignores a web link with no host instead of throwing", () => {
    mount('<a href="https://">Nowhere</a>');
    expect(click(root.querySelector("a")!).defaultPrevented).toBe(true);
    expect(open).not.toHaveBeenCalled();
  });

  it("falls back to xlink:href when href is empty", () => {
    mount('<svg><a href="" xlink:href="https://example.com/svg"><text>Node</text></a></svg>');
    click(root.querySelector("text")!);
    expect(open).toHaveBeenCalledWith("https://example.com/svg", "_blank", "noopener,noreferrer");
  });

  it("keeps a link the sanitizer emptied, such as a javascript: one, inert", () => {
    mount("<a>Run it</a>");
    expect(click(root.querySelector("a")!).defaultPrevented).toBe(true);
    expect(open).not.toHaveBeenCalled();
  });

  it("ignores a click dispatched on a text node", () => {
    mount('<a href="https://example.com">Out</a>');
    const text = root.querySelector("a")!.firstChild!;
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    text.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it("makes a relative link to another file inert", () => {
    mount('<a href="other.md">Other</a>');
    expect(click(root.querySelector("a")!).defaultPrevented).toBe(true);
    expect(open).not.toHaveBeenCalled();
  });

  it("handles a click on an element nested in a link", () => {
    mount('<a href="https://example.com"><strong>Bold</strong></a>');
    click(root.querySelector("strong")!);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("leaves mail links and clicks outside links alone", () => {
    mount('<a href="MAILTO:someone@example.com">Mail</a><p>Text</p>');
    expect(click(root.querySelector("a")!).defaultPrevented).toBe(false);
    expect(click(root.querySelector("p")!).defaultPrevented).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});
