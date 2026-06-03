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
