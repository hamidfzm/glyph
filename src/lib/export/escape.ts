// Escape text for safe interpolation into HTML/XML attribute and text nodes.
// `<` `>` `&` cover element/entity boundaries; `"` covers double-quoted
// attributes (used for titles in <title> and OPF metadata).
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// HTML ends a <style> at `</style` even inside a CSS string, letting plugin CSS
// add a script to an exported page. CSS reads `<\/` as `</`.
export function escapeStyleText(css: string): string {
  return css.replace(/<\//g, "<\\/");
}
