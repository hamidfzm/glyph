import { afterEach, describe, expect, it, vi } from "vitest";
import { buildHtmlDocument } from "@/lib/export/html";
import { siteChromeScript } from "@/lib/export/siteChrome";
import { LIGHTBOX_SCRIPT } from "./lightboxScript";

// Mount a site page body and run the shipped script. Its DOMContentLoaded
// handler is captured and called directly so earlier tests' instances don't
// also bind to this page.
function mount(bodyHtml: string) {
  document.body.innerHTML = `<div class="markdown-body">${bodyHtml}</div>`;
  let ready: (() => void) | undefined;
  const spy = vi.spyOn(document, "addEventListener").mockImplementationOnce((_type, handler) => {
    ready = handler as () => void;
  });
  new Function(LIGHTBOX_SCRIPT)();
  spy.mockRestore();
  ready?.();
}

const overlay = () => document.querySelector<HTMLElement>(".lightbox-overlay");
const lightboxImg = () => document.querySelector<HTMLImageElement>(".lightbox-image");
const press = (key: string) => document.dispatchEvent(new KeyboardEvent("keydown", { key }));
const clickLabel = (label: string) =>
  document.querySelector<HTMLButtonElement>(`.lightbox-overlay [aria-label="${label}"]`)?.click();

const MERMAID =
  '<div class="mermaid-diagram"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200" width="100%"><rect width="10" height="10"/></svg></div>';

afterEach(() => {
  // Close any lightbox left open so its key listener goes away.
  press("Escape");
  document.body.innerHTML = "";
  document.body.style.overflow = "";
});

describe("site lightbox script", () => {
  it("ships in the shared site.js but not in single-file exports", () => {
    expect(siteChromeScript()).toContain(LIGHTBOX_SCRIPT);
    const single = buildHtmlDocument({ bodyHtml: "<p>x</p>", title: "t", css: "", dark: false });
    expect(single).not.toContain("lightbox-overlay");
  });

  it("does nothing on a page without images or diagrams", () => {
    mount("<p>text</p>");
    expect(document.querySelector("[data-zoomable]")).toBeNull();
    expect(overlay()).toBeNull();
  });

  it("opens an image, zooms, and closes on Escape with focus returned", () => {
    mount('<img src="a.png" alt="Shot">');
    const trigger = document.querySelector<HTMLImageElement>(".markdown-body img");
    expect(trigger?.dataset.zoomable).toBe("true");
    expect(trigger?.tabIndex).toBe(0);

    trigger?.click();
    expect(overlay()?.getAttribute("aria-label")).toBe("Image: Shot");
    expect(lightboxImg()?.getAttribute("src")).toContain("a.png");
    expect(document.body.style.overflow).toBe("hidden");
    // A single image has no navigation or counter.
    expect(document.querySelector(".lightbox-prev")).toBeNull();
    expect(document.querySelector(".lightbox-counter")).toBeNull();

    lightboxImg()?.dispatchEvent(new Event("load"));
    const level = () => document.querySelector(".lightbox-zoom-level")?.textContent;
    press("1");
    expect(level()).toBe("100%");
    press("+");
    expect(level()).toBe("125%");
    clickLabel("Zoom out (-)");
    expect(level()).toBe("100%");

    press("Escape");
    expect(overlay()).toBeNull();
    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe(trigger);
  });

  it("opens a Mermaid diagram from its wrapper as an SVG data URL sized by viewBox", () => {
    mount(MERMAID);
    const wrapper = document.querySelector<HTMLElement>(".mermaid-diagram");
    expect(wrapper?.getAttribute("role")).toBe("button");

    wrapper?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    const src = lightboxImg()?.getAttribute("src") ?? "";
    expect(src.startsWith("data:image/svg+xml")).toBe(true);
    expect(decodeURIComponent(src)).toContain('viewBox="0 0 400 200"');

    expect(lightboxImg()?.style.background).toContain("#fff");

    lightboxImg()?.dispatchEvent(new Event("load"));
    press("1");
    expect(lightboxImg()?.style.width).toBe("400px");
  });

  it("navigates between items with arrows and buttons, clamped at the ends", () => {
    mount(`<img src="a.png" alt="A">${MERMAID}<img src="c.png" alt="C">`);
    document.querySelector<HTMLImageElement>('img[alt="A"]')?.click();
    const counter = () => document.querySelector(".lightbox-counter")?.textContent;
    expect(counter()).toBe("1 / 3");
    expect(document.querySelector<HTMLButtonElement>(".lightbox-prev")?.disabled).toBe(true);

    press("ArrowLeft");
    expect(counter()).toBe("1 / 3");
    press("ArrowRight");
    expect(counter()).toBe("2 / 3");
    expect(lightboxImg()?.alt).toBe("Diagram");
    clickLabel("Next image (→)");
    expect(counter()).toBe("3 / 3");
    expect(document.querySelector<HTMLButtonElement>(".lightbox-next")?.disabled).toBe(true);
  });

  it("closes on a backdrop click but not on toolbar clicks", () => {
    mount('<img src="a.png" alt="A">');
    document.querySelector<HTMLImageElement>(".markdown-body img")?.click();
    clickLabel("Fit to screen (0)");
    lightboxImg()?.click();
    expect(overlay()).not.toBeNull();

    overlay()?.click();
    expect(overlay()).toBeNull();
  });

  it("zooms a linked image instead of following the link, leaving focus to the link", () => {
    mount('<a href="big.png"><img src="a.png" alt="A"></a>');
    const img = document.querySelector<HTMLImageElement>(".markdown-body img");
    expect(img?.hasAttribute("tabindex")).toBe(false);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    img?.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(overlay()).not.toBeNull();

    press("Escape");
    expect(document.activeElement).toBe(document.querySelector("a"));
  });

  it("leaves modified keys to the browser", () => {
    mount('<img src="a.png" alt="A">');
    document.querySelector<HTMLImageElement>(".markdown-body img")?.click();
    const zoom = new KeyboardEvent("keydown", { key: "+", ctrlKey: true, cancelable: true });
    document.dispatchEvent(zoom);
    expect(zoom.defaultPrevented).toBe(false);
    expect(document.querySelector(".lightbox-zoom-level")?.textContent).toBe("100%");
  });

  it("shows a broken image instead of leaving it hidden", () => {
    mount('<img src="missing.png" alt="A">');
    document.querySelector<HTMLImageElement>(".markdown-body img")?.click();
    expect(lightboxImg()?.style.opacity).toBe("0");
    lightboxImg()?.dispatchEvent(new Event("error"));
    expect(lightboxImg()?.style.opacity).toBe("1");
  });
});
