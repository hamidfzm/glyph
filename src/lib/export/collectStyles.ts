/**
 * Serialize every CSS rule currently applied to the document into one string.
 *
 * The app's Tailwind v4 output, component CSS, KaTeX, and the active code theme
 * are all injected as `<style>`/`<link>` sheets, so walking `document.styleSheets`
 * captures everything needed to render exported HTML/EPUB standalone, offline.
 *
 * Stylesheets the browser blocks from rule access (cross-origin without CORS)
 * throw on `.cssRules`; we skip those rather than fail the whole export.
 */
export function collectStyles(doc: Document = document): string {
  const chunks: string[] = [];
  for (const sheet of Array.from(doc.styleSheets)) {
    let rules: CSSRuleList | undefined;
    try {
      rules = sheet.cssRules;
    } catch {
      // Opaque (cross-origin) sheet — its rules aren't readable. Skip it.
      continue;
    }
    if (!rules) continue;
    for (const rule of Array.from(rules)) {
      chunks.push(rule.cssText);
    }
  }
  return chunks.join("\n");
}
