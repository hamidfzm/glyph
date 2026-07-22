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
#glyph-theme-toggle { position: fixed; top: 1rem; right: 1rem; z-index: 1000; width: 2.4rem; height: 2.4rem; display: flex; align-items: center; justify-content: center; border-radius: 9999px; border: 1px solid var(--color-border, #d0d0d0); background: var(--color-surface, #fff); color: var(--color-text-primary, #1d1d1f); font-size: 1.1rem; line-height: 1; cursor: pointer; box-shadow: 0 1px 4px rgba(0,0,0,0.15); transition: transform 160ms cubic-bezier(0.23, 1, 0.32, 1), background-color 150ms ease; }
#glyph-theme-toggle:hover { background: var(--color-hover, rgba(175, 184, 193, 0.2)); }
#glyph-theme-toggle:active { transform: scale(0.92); }
#glyph-theme-toggle:focus-visible { outline: 2px solid var(--color-accent, #0969da); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) {
  #glyph-theme-toggle { transition: none; }
  #glyph-theme-toggle:active { transform: none; }
}
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

// Outline scroll spy for site pages: marks the outline link of the section
// currently in view (.active). The active section is the last heading above
// a fixed reading line, updated at most once per frame; no-op on pages
// without an outline.
const OUTLINE_SPY_SCRIPT = `(function(){document.addEventListener('DOMContentLoaded',function(){var outline=document.querySelector('.glyph-site-outline');if(!outline)return;var targets=[];var anchors=outline.querySelectorAll('a[href^="#"]');for(var i=0;i<anchors.length;i++){var id=decodeURIComponent(anchors[i].getAttribute('href').slice(1));var el=document.getElementById(id);if(el)targets.push({a:anchors[i],el:el})}if(!targets.length)return;var active=null;function update(){var line=window.scrollY+96;var atEnd=window.innerHeight+window.scrollY>=document.documentElement.scrollHeight-2;var current=targets[0];for(var i=0;i<targets.length;i++){if(targets[i].el.getBoundingClientRect().top+window.scrollY<=line)current=targets[i]}if(atEnd)current=targets[targets.length-1];if(current===active)return;if(active)active.a.classList.remove('active');current.a.classList.add('active');active=current}var ticking=false;function onScroll(){if(ticking)return;ticking=true;requestAnimationFrame(function(){ticking=false;update()})}window.addEventListener('scroll',onScroll,{passive:true});window.addEventListener('resize',onScroll,{passive:true});update()})})();`;

/**
 * Chrome CSS shared by every generated site page (viewport reset, theme
 * toggle, nav/outline layout). The site exporter appends it once to the
 * shared style.css instead of inlining it into each page; single-file
 * exports keep it inline and stay self-contained.
 */
export function siteChromeCss(): string {
  return `${LAYOUT_OVERRIDES}${SITE_LAYOUT}`;
}

/**
 * Script shared by every generated site page, written once as the site's
 * site.js: the theme toggle (loaded synchronously from <head> so the dark
 * class is applied before first paint, exactly like the inline variant) plus
 * the outline scroll spy. Single-file exports inline only the theme script.
 */
export function siteChromeScript(): string {
  return `${THEME_SCRIPT}\n${OUTLINE_SPY_SCRIPT}`;
}

// Site layout for the multi-page export: sticky nav tree beside the content
// column, plus an optional per-page outline column on the far side. Nav
// stacks on narrow viewports; the outline hides instead (a heading list at
// the bottom of the page is useless). Only emitted when a page has nav markup.
// Fragment jumps scroll smoothly and land clear of a sticky header
// (scroll-margin-top); both respect prefers-reduced-motion.
const SITE_LAYOUT = `
html { scroll-behavior: smooth; }
.markdown-body [id] { scroll-margin-top: 5rem; }
.glyph-site { display: flex; gap: 2.5rem; max-width: 1360px; margin: 0 auto; align-items: flex-start; }
.glyph-site-nav { position: sticky; top: 1rem; flex: 0 0 230px; max-height: calc(100vh - 2rem); overflow-y: auto; overscroll-behavior: contain; font-size: 0.875rem; padding-bottom: 1rem; }
.glyph-site-nav ul { list-style: none; margin: 0; padding-left: 0; }
.glyph-site-nav details > ul { padding-left: 0.875rem; }
.glyph-site-nav li { margin: 0; }
.glyph-site-nav summary { display: flex; align-items: center; gap: 0.35rem; padding: 0.28rem 0.5rem; border-radius: 6px; cursor: pointer; user-select: none; list-style: none; font-weight: 600; color: var(--color-text-primary, inherit); }
.glyph-site-nav summary::-webkit-details-marker { display: none; }
.glyph-site-nav summary::before { content: ""; width: 0.4em; height: 0.4em; flex: none; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; opacity: 0.55; transform: rotate(-45deg); transition: transform 200ms cubic-bezier(0.23, 1, 0.32, 1); }
.glyph-site-nav details[open] > summary::before { transform: rotate(45deg); }
.glyph-site-nav a { display: block; padding: 0.28rem 0.5rem; border-radius: 6px; text-decoration: none; color: var(--color-text-secondary, #57606a); transition: color 150ms ease, background-color 150ms ease; }
.glyph-site-nav a:hover { color: var(--color-text-primary, #1f2328); }
.glyph-site-nav a[aria-current="page"] { color: var(--color-accent, #0969da); font-weight: 600; }
.glyph-site-nav a:focus-visible, .glyph-site-nav summary:focus-visible, .glyph-site-outline a:focus-visible { outline: 2px solid var(--color-accent, #0969da); outline-offset: -2px; }
.glyph-site-main { flex: 1 1 auto; min-width: 0; }
.glyph-site-main .markdown-body { margin: 0; }
.glyph-site-header { max-width: 1320px; margin: 0 auto 1.25rem; font-size: 1.05rem; }
.glyph-site-header a { color: var(--color-text-primary, inherit); font-weight: 600; text-decoration: none; }
.glyph-site-outline { position: sticky; top: 1rem; flex: 0 0 210px; max-height: calc(100vh - 2rem); overflow-y: auto; overscroll-behavior: contain; font-size: 0.8125rem; }
.glyph-site-outline ul { list-style: none; margin: 0; padding: 0; }
.glyph-site-outline li { margin: 0; }
.glyph-site-outline a { display: block; padding: 0.22rem 0 0.22rem 0.85rem; border-left: 2px solid transparent; text-decoration: none; color: var(--color-text-secondary, #57606a); transition: color 150ms ease, border-color 150ms ease; }
.glyph-site-outline a:hover { color: var(--color-text-primary, #1f2328); }
.glyph-site-outline a.active { color: var(--color-accent, #0969da); border-left-color: var(--color-accent, #0969da); }
.glyph-outline-l3 a { padding-left: 1.6rem; }
.glyph-outline-l4 a, .glyph-outline-l5 a, .glyph-outline-l6 a { padding-left: 2.35rem; }
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  .glyph-site-nav summary::before, .glyph-site-nav a, .glyph-site-outline a { transition: none; }
}
@media (max-width: 1024px) { .glyph-site-outline { display: none; } }
@media (max-width: 768px) {
  .glyph-site { flex-direction: column; }
  .glyph-site-nav { position: static; flex: none; width: 100%; }
}
@media print { .glyph-site-header, .glyph-site-nav, .glyph-site-outline { display: none; } }`;

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
