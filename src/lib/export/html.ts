import { escapeXml } from "./escape";

export interface HtmlDocOptions {
  bodyHtml: string;
  title: string;
  css: string;
  // Carry the current theme so the exported file matches what the user saw.
  dark: boolean;
}

/**
 * Wrap prepared body HTML and collected CSS into a standalone, offline HTML
 * document. The `.markdown-body` wrapper and optional `.dark` class mirror the
 * app shell so the bundled styles apply unchanged.
 */
export function buildHtmlDocument({ bodyHtml, title, css, dark }: HtmlDocOptions): string {
  const htmlClass = dark ? ' class="dark"' : "";
  return `<!doctype html>
<html lang="en"${htmlClass}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeXml(title)}</title>
<style>
${css}
</style>
</head>
<body>
<div class="markdown-body">
${bodyHtml}
</div>
</body>
</html>
`;
}
