import { escapeXml } from "./escape";

export interface HtmlDocOptions {
  bodyHtml: string;
  title: string;
  css: string;
  // Export-time theme, used only as the no-JS fallback; the runtime script
  // below syncs to the reader's system preference.
  dark: boolean;
  // Wrapper class so bundled styles apply (markdown vs notebook body).
  bodyClass?: "markdown-body" | "notebook-body";
}

// The app's base styles lock the shell to the viewport (`html, body, #root {
// height: 100%; overflow: hidden }`) and the markdown body is normally laid out
// inside a separate scroll container. A standalone page has neither, so reset
// to normal document flow and give the content a centered, padded column. The
// floating theme toggle is hidden when printing.
const LAYOUT_OVERRIDES = `
html, body { height: auto; min-height: 100%; overflow: visible; }
body { margin: 0; padding: 2rem 1.25rem; }
.markdown-body, .notebook-body { max-width: 820px; height: auto; margin: 0 auto; overflow: visible; }
#glyph-theme-toggle { position: fixed; top: 1rem; right: 1rem; z-index: 1000; width: 2.4rem; height: 2.4rem; display: flex; align-items: center; justify-content: center; border-radius: 9999px; border: 1px solid var(--color-border, #d0d0d0); background: var(--color-surface, #fff); color: var(--color-text-primary, #1d1d1f); font-size: 1.1rem; line-height: 1; cursor: pointer; box-shadow: 0 1px 4px rgba(0,0,0,0.15); }
@media print { #glyph-theme-toggle { display: none; } }`;

// Theme handling for the standalone file. A stored choice (the toggle button)
// wins; otherwise it follows the reader's OS preference. The apply() runs in
// <head> before paint to avoid a flash; the button is wired on DOMContentLoaded.
// The app's dark styles are class-based, so toggling `.dark` reuses them all.
const THEME_SCRIPT = `(function(){try{var root=document.documentElement,KEY='glyph-export-theme',mq=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)');function stored(){try{return localStorage.getItem(KEY)}catch(e){return null}}function apply(){var s=stored();root.classList.toggle('dark',s==='dark'||(s===null&&!!mq&&mq.matches))}apply();if(mq&&mq.addEventListener)mq.addEventListener('change',function(){if(stored()===null)apply()});document.addEventListener('DOMContentLoaded',function(){var b=document.getElementById('glyph-theme-toggle');if(!b)return;b.addEventListener('click',function(){var d=!root.classList.contains('dark');root.classList.toggle('dark',d);try{localStorage.setItem(KEY,d?'dark':'light')}catch(e){}})})}catch(e){}})();`;

const THEME_TOGGLE_BUTTON = `<button id="glyph-theme-toggle" type="button" aria-label="Toggle dark mode" title="Toggle dark mode">\u{25D1}</button>`;

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
}: HtmlDocOptions): string {
  const initialClass = dark ? ' class="dark"' : "";
  return `<!doctype html>
<html lang="en"${initialClass}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeXml(title)}</title>
<script>${THEME_SCRIPT}</script>
<style>
${css}
${LAYOUT_OVERRIDES}
</style>
</head>
<body>
${THEME_TOGGLE_BUTTON}
<div class="${bodyClass}">
${bodyHtml}
</div>
</body>
</html>
`;
}
