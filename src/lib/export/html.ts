import { escapeXml } from "./escape";
import { LAYOUT_OVERRIDES, SITE_LAYOUT, THEME_SCRIPT, THEME_TOGGLE_BUTTON } from "./siteChrome";

export interface HtmlDocOptions {
  bodyHtml: string;
  title: string;
  css: string;
  // Export-time theme, used only as the no-JS fallback; the runtime script
  // below syncs to the reader's system preference.
  dark: boolean;
  // Wrapper class so bundled styles apply (markdown vs notebook body).
  bodyClass?: "markdown-body" | "notebook-body" | "glyph-canvas-page";
  // Multi-page site export: link a shared stylesheet instead of carrying the
  // collected app CSS inline in every page. The page then emits no <style> at
  // all (`css` is ignored); the shared sheet must include siteChromeCss().
  stylesheetHref?: string;
  // Multi-page site export: link the shared theme script (siteChromeScript(),
  // written once as site.js) instead of inlining it into every page.
  scriptHref?: string;
  // Multi-page site export: navigation tree markup placed beside the content.
  navHtml?: string;
  // Multi-page site export: per-page "On this page" outline, shown as a
  // second sticky column on wide viewports. Only honored alongside navHtml.
  outlineHtml?: string | null;
  // Extra head markup (favicon link, social meta tags), emitted verbatim
  // after <title>. The caller is responsible for escaping.
  headHtml?: string;
  // Multi-page site export: site header bar markup, rendered before the
  // two-column layout. Only honored alongside navHtml.
  headerHtml?: string;
}

export function buildHtmlDocument({
  bodyHtml,
  title,
  css,
  dark,
  bodyClass = "markdown-body",
  stylesheetHref,
  scriptHref,
  navHtml,
  outlineHtml,
  headHtml,
  headerHtml,
}: HtmlDocOptions): string {
  const initialClass = dark ? ' class="dark"' : "";
  const stylesheetLink = stylesheetHref
    ? `\n<link rel="stylesheet" href="${escapeXml(stylesheetHref)}">`
    : "";
  // Site pages share one script file; single-file exports inline it to stay
  // self-contained. Either way it loads synchronously in <head> so the theme
  // class lands before first paint.
  const themeScript = scriptHref
    ? `<script src="${escapeXml(scriptHref)}"></script>`
    : `<script>${THEME_SCRIPT}</script>`;
  // With a shared stylesheet the page carries no CSS of its own.
  const styleBlock = stylesheetHref
    ? ""
    : `\n<style>
${css}
${LAYOUT_OVERRIDES}${navHtml ? SITE_LAYOUT : ""}
</style>`;
  // dir="auto" mirrors the viewer: a fully-RTL document resolves an RTL base
  // direction; per-block bidi comes from the bundled markdown.css rules.
  const content = `<div class="${bodyClass}" dir="auto">
${bodyHtml}
</div>`;
  const body = navHtml
    ? `${headerHtml ? `${headerHtml}\n` : ""}<div class="glyph-site">
${navHtml}
<main class="glyph-site-main">
${content}
</main>${outlineHtml ? `\n${outlineHtml}` : ""}
</div>`
    : content;
  return `<!doctype html>
<html lang="en"${initialClass}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeXml(title)}</title>
${headHtml ? `${headHtml}\n` : ""}${themeScript}${stylesheetLink}${styleBlock}
</head>
<body>
${THEME_TOGGLE_BUTTON}
${body}
</body>
</html>
`;
}
