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
// to normal document flow and give the content a centered, padded column.
const LAYOUT_OVERRIDES = `
html, body { height: auto; min-height: 100%; overflow: visible; }
body { margin: 0; padding: 2rem 1.25rem; }
.markdown-body, .notebook-body { max-width: 820px; height: auto; margin: 0 auto; overflow: visible; }`;

// Sync the `.dark` class to the reader's OS preference (the app's dark styles
// are class-based, so this reuses every `.dark` rule already in the CSS). Runs
// in <head> before paint to avoid a flash, and reacts to live changes.
const THEME_SCRIPT = `(function(){try{var m=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)');if(!m)return;var apply=function(){document.documentElement.classList.toggle('dark',m.matches);};apply();m.addEventListener('change',apply);}catch(e){}})();`;

/**
 * Wrap prepared body HTML and collected CSS into a standalone, offline HTML
 * document. The page scrolls like a normal web page and follows the reader's
 * light/dark system preference (falling back to the export-time theme without
 * JS). The `.markdown-body` wrapper mirrors the app shell so bundled styles
 * apply unchanged.
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
<div class="${bodyClass}">
${bodyHtml}
</div>
</body>
</html>
`;
}
