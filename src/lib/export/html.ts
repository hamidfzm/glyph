import { escapeXml } from "./escape";

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
  // collected app CSS inline in every page (`css` then holds only page-specific
  // extras, usually "").
  stylesheetHref?: string;
  // Multi-page site export: navigation tree markup placed beside the content.
  navHtml?: string;
  // Multi-page site export: per-page "On this page" outline, shown as a
  // second sticky column on wide viewports. Only honored alongside navHtml.
  outlineHtml?: string | null;
}

// The app's base styles lock the shell to the viewport (`html, body, #root {
// height: 100%; overflow: hidden }`) and the markdown body is normally laid out
// inside a separate scroll container. A standalone page has neither, so reset
// to normal document flow and give the content a centered, padded column. The
// floating theme toggle is hidden when printing.
const LAYOUT_OVERRIDES = `
/* Native controls (checkboxes, scrollbars) follow the toggled class, not just
   the OS preference — without this the dark toggle leaves them light. */
:root { color-scheme: light; }
:root.dark { color-scheme: dark; }
html, body { height: auto; min-height: 100%; overflow: visible; }
body { margin: 0; padding: 2rem 1.25rem; }
.markdown-body, .notebook-body { max-width: 820px; height: auto; margin: 0 auto; overflow: visible; }
#glyph-theme-toggle { position: fixed; top: 1rem; right: 1rem; z-index: 1000; width: 2.4rem; height: 2.4rem; display: flex; align-items: center; justify-content: center; border-radius: 9999px; border: 1px solid var(--color-border, #d0d0d0); background: var(--color-surface, #fff); color: var(--color-text-primary, #1d1d1f); font-size: 1.1rem; line-height: 1; cursor: pointer; box-shadow: 0 1px 4px rgba(0,0,0,0.15); }
@media print {
  #glyph-theme-toggle { display: none; }
  /* On screen code blocks scroll; when printed they wrap so nothing is clipped. */
  .markdown-body pre, .notebook-body pre, .markdown-body pre code, .notebook-body pre code { white-space: pre-wrap; overflow-wrap: anywhere; overflow-x: visible; }
}`;

// Theme handling for the standalone file. A stored choice (the toggle button)
// wins; otherwise it follows the reader's OS preference. The apply() runs in
// <head> before paint to avoid a flash; the button is wired on DOMContentLoaded.
// The app's dark styles are class-based, so toggling `.dark` reuses them all.
const THEME_SCRIPT = `(function(){try{var root=document.documentElement,KEY='glyph-export-theme',mq=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)');function stored(){try{return localStorage.getItem(KEY)}catch(e){return null}}function apply(){var s=stored();root.classList.toggle('dark',s==='dark'||(s===null&&!!mq&&mq.matches))}apply();if(mq&&mq.addEventListener)mq.addEventListener('change',function(){if(stored()===null)apply()});document.addEventListener('DOMContentLoaded',function(){var b=document.getElementById('glyph-theme-toggle');if(!b)return;b.addEventListener('click',function(){var d=!root.classList.contains('dark');root.classList.toggle('dark',d);try{localStorage.setItem(KEY,d?'dark':'light')}catch(e){}})})}catch(e){}})();`;

const THEME_TOGGLE_BUTTON = `<button id="glyph-theme-toggle" type="button" aria-label="Toggle dark mode" title="Toggle dark mode">\u{25D1}</button>`;

// Site layout for the multi-page export: sticky nav tree beside the content
// column, plus an optional per-page outline column on the far side. Nav
// stacks on narrow viewports; the outline hides instead (a heading list at
// the bottom of the page is useless). Only emitted when a page has nav markup.
const SITE_LAYOUT = `
.glyph-site { display: flex; gap: 2rem; max-width: 1320px; margin: 0 auto; align-items: flex-start; }
.glyph-site-nav { position: sticky; top: 1rem; flex: 0 0 220px; max-height: calc(100vh - 2rem); overflow-y: auto; font-size: 0.875rem; }
.glyph-site-nav ul { list-style: none; margin: 0; padding-left: 0.75rem; }
.glyph-site-nav > ul { padding-left: 0; }
.glyph-site-nav li { margin: 0.15rem 0; }
.glyph-site-nav summary { cursor: pointer; font-weight: 600; color: var(--color-text-primary, inherit); }
.glyph-site-nav a { text-decoration: none; color: var(--color-text-secondary, #57606a); }
.glyph-site-nav a:hover { color: var(--color-accent, #0969da); }
.glyph-site-nav a[aria-current="page"] { color: var(--color-accent, #0969da); font-weight: 600; }
.glyph-site-main { flex: 1 1 auto; min-width: 0; }
.glyph-site-main .markdown-body { margin: 0; }
.glyph-site-outline { position: sticky; top: 1rem; flex: 0 0 200px; max-height: calc(100vh - 2rem); overflow-y: auto; font-size: 0.8125rem; }
.glyph-site-outline ul { list-style: none; margin: 0; padding: 0; }
.glyph-site-outline li { margin: 0.2rem 0; }
.glyph-site-outline a { text-decoration: none; color: var(--color-text-secondary, #57606a); }
.glyph-site-outline a:hover { color: var(--color-accent, #0969da); }
.glyph-outline-l2 { padding-left: 0.75rem; }
.glyph-outline-l3 { padding-left: 1.5rem; }
.glyph-outline-l4, .glyph-outline-l5, .glyph-outline-l6 { padding-left: 2.25rem; }
@media (max-width: 1024px) { .glyph-site-outline { display: none; } }
@media (max-width: 768px) {
  .glyph-site { flex-direction: column; }
  .glyph-site-nav { position: static; flex: none; width: 100%; }
}
@media print { .glyph-site-nav, .glyph-site-outline { display: none; } }`;

/**
 * Wrap prepared body HTML and collected CSS into a standalone, offline HTML
 * document. The page scrolls like a normal web page and includes a light/dark
 * toggle that persists a choice and otherwise follows the reader's system
 * preference (falling back to the export-time theme without JS). The body
 * wrapper class mirrors the app shell so bundled styles apply unchanged.
 */
export function buildHtmlDocument({
  bodyHtml,
  title,
  css,
  dark,
  bodyClass = "markdown-body",
  stylesheetHref,
  navHtml,
  outlineHtml,
}: HtmlDocOptions): string {
  const initialClass = dark ? ' class="dark"' : "";
  const stylesheetLink = stylesheetHref
    ? `\n<link rel="stylesheet" href="${escapeXml(stylesheetHref)}">`
    : "";
  // dir="auto" mirrors the viewer: a fully-RTL document resolves an RTL base
  // direction; per-block bidi comes from the bundled markdown.css rules.
  const content = `<div class="${bodyClass}" dir="auto">
${bodyHtml}
</div>`;
  const body = navHtml
    ? `<div class="glyph-site">
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
<script>${THEME_SCRIPT}</script>${stylesheetLink}
<style>
${css}
${LAYOUT_OVERRIDES}${navHtml ? SITE_LAYOUT : ""}
</style>
</head>
<body>
${THEME_TOGGLE_BUTTON}
${body}
</body>
</html>
`;
}
