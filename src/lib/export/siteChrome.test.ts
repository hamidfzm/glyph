import { afterEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/lib/i18n";
import { lightboxLabels } from "./site/lightboxScript";
import { buildNavHtml, type SitePage } from "./site/nav";
import { NAV_STATE_SCRIPT, siteChromeScript } from "./siteChrome";

const PAGES: SitePage[] = [
  { rel: "index.html", title: "Home" },
  { rel: "guide/intro.html", title: "Intro" },
  { rel: "guide/deep/page.html", title: "Deep" },
  { rel: "reference/api.html", title: "API" },
];

let leavePage: (() => void) | undefined;

// Render a site page's nav and run the shipped script, first "leaving" the
// previous page. The script's DOMContentLoaded and pagehide handlers are
// captured and called directly, standing in for a page load and unload.
function loadPage(currentRel: string) {
  leavePage?.();
  document.body.innerHTML = buildNavHtml(PAGES, currentRel);
  let ready: (() => void) | undefined;
  const onDocument = vi
    .spyOn(document, "addEventListener")
    .mockImplementationOnce((_type, handler) => {
      ready = handler as () => void;
    });
  const onWindow = vi.spyOn(window, "addEventListener").mockImplementationOnce((_type, handler) => {
    leavePage = handler as () => void;
  });
  new Function(NAV_STATE_SCRIPT)();
  ready?.();
  onDocument.mockRestore();
  onWindow.mockRestore();
}

const folder = (path: string) =>
  document.querySelector<HTMLDetailsElement>(`details[data-path="${path}"]`);

function toggle(path: string, open: boolean) {
  const d = folder(path);
  if (!d) throw new Error(`no folder ${path}`);
  d.open = open;
}

afterEach(() => {
  leavePage = undefined;
  sessionStorage.clear();
  document.body.innerHTML = "";
});

describe("site nav folder memory", () => {
  it("ships in the shared site script", () => {
    expect(siteChromeScript(lightboxLabels(i18n.t))).toContain(NAV_STATE_SCRIPT);
  });

  it("starts with only the current page's folders open", () => {
    loadPage("guide/deep/page.html");
    expect(folder("guide")?.open).toBe(true);
    expect(folder("guide/deep")?.open).toBe(true);
    expect(folder("reference")?.open).toBe(false);
  });

  it("remembers folders the reader opens or closes across pages", () => {
    loadPage("index.html");
    toggle("reference", true);

    loadPage("guide/intro.html");
    expect(folder("reference")?.open).toBe(true);
    toggle("reference", false);

    loadPage("index.html");
    expect(folder("reference")?.open).toBe(false);
    // Visiting guide/ opened it, so it stays open on the next page.
    expect(folder("guide")?.open).toBe(true);
  });

  it("keeps the current page's folders open even if the reader closed them", () => {
    loadPage("index.html");
    toggle("guide", true);
    toggle("guide", false);

    loadPage("guide/intro.html");
    expect(folder("guide")?.open).toBe(true);
  });

  it("falls back to the default when stored state is unreadable", () => {
    sessionStorage.setItem("glyph-site-nav", "{broken");
    loadPage("index.html");
    expect(folder("reference")?.open).toBe(false);
  });

  it("uses per-tab session storage, not local storage", () => {
    loadPage("index.html");
    toggle("reference", true);
    leavePage?.();
    expect(sessionStorage.getItem("glyph-site-nav")).toContain('"reference":true');
    expect(localStorage.getItem("glyph-site-nav")).toBeNull();
  });
});
