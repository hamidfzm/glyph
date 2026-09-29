import { staticRendererFor } from "@/lib/plugins/staticRenderers";

type RendererFor = (language: string) => ((code: string) => Promise<string>) | undefined;

/**
 * Replace fenced code blocks in rendered page HTML with their plugin's static
 * render (the light markup print and PDF use). Plugin renderers mount in the
 * live document, so the headless unified pipeline leaves the fenced source as
 * a plain code block; this pass swaps each one whose language has a static
 * render. A block that fails to render keeps its source code block so the page
 * still shows something useful.
 */
export async function inlineStaticRenders(
  html: string,
  renderFor: RendererFor = staticRendererFor,
): Promise<string> {
  const doc = new DOMParser().parseFromString(html, "text/html");
  let replaced = false;
  for (const code of Array.from(doc.body.querySelectorAll("pre > code"))) {
    const language = /\blanguage-([\w-]+)\b/.exec(code.className)?.[1];
    const render = language ? renderFor(language) : undefined;
    if (!language || !render) continue;
    try {
      // textContent is typed nullable but is always a string on elements.
      const markup = await render(String(code.textContent));
      // Plugin output goes into a page anyone can open; <foreignObject> is
      // the SVG-embedded-HTML vector.
      const { default: DOMPurify } = await import("dompurify");
      const wrapper = doc.createElement("div");
      // The marker the site lightbox finds diagrams by, as in the app.
      wrapper.setAttribute("data-fenced-language", language);
      wrapper.innerHTML = DOMPurify.sanitize(markup, { FORBID_TAGS: ["foreignObject"] });
      dropExternalImages(wrapper);
      (code.parentElement as HTMLElement).replaceWith(wrapper);
      replaced = true;
    } catch {
      // Leave the source block in place.
    }
  }
  return replaced ? doc.body.innerHTML : html;
}

// Static renders skip the site's URL rewriter, so an image path in one would
// point readers at the author's filesystem or fetch from a third party on
// every page view. Only inline `data:` images are kept.
function dropExternalImages(root: Element): void {
  for (const el of Array.from(root.querySelectorAll("img, image"))) {
    for (const attr of ["src", "href", "xlink:href"]) {
      const value = el.getAttribute(attr);
      if (value !== null && !/^\s*data:/i.test(value)) el.removeAttribute(attr);
    }
  }
}
