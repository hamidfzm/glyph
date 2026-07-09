import { renderMermaidLightSvg } from "@/lib/export/rasterize";

/**
 * Replace ` ```mermaid ` code blocks in rendered page HTML with inline SVG.
 * Mermaid renders client-side, so the headless unified pipeline leaves the
 * fenced source as a plain code block; this pass swaps each one for the light
 * theme SVG the PDF exporter also uses. A diagram that fails to render keeps
 * its source code block so the page still shows something useful.
 * The caller restores Mermaid's global theme after the export run.
 */
export async function inlineMermaidSvgs(
  html: string,
  render: (source: string) => Promise<string> = renderMermaidLightSvg,
): Promise<string> {
  const doc = new DOMParser().parseFromString(html, "text/html");
  let replaced = false;
  for (const pre of Array.from(doc.body.querySelectorAll("pre"))) {
    const code = pre.querySelector(":scope > code.language-mermaid");
    if (!code) continue;
    try {
      // textContent is typed nullable but is always a string on elements.
      const svg = await render(String(code.textContent));
      const wrapper = doc.createElement("div");
      wrapper.className = "mermaid-diagram";
      wrapper.innerHTML = svg;
      pre.replaceWith(wrapper);
      replaced = true;
    } catch {
      // Leave the source block in place.
    }
  }
  return replaced ? doc.body.innerHTML : html;
}
