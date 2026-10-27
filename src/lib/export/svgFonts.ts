// pdfmake's SVG renderer ignores @font-face but draws text in any font
// registered with pdfmake, matched by family name. So each embedded font is
// registered under a name of its own and the SVG's references to its family are
// rewritten to it: two drawings that both embed "Excalifont", each subset to
// its own glyphs, must not share one font.

import { embeddedFontFamily } from "./embeddedFonts";

const FONT_FACE = /@font-face\s*\{([^}]*)\}/g;
const FACE_FAMILY = /font-family\s*:\s*([^;]+)/;
// Only inline font data: a font behind a URL is never fetched.
const BASE64_SRC = /url\(\s*["']?data:[^,"')]*;base64,([^"')]+)/;
const FAMILY_DECLARATION = /(font-family\s*:\s*)([^;}]+)/g;

function unquote(family: string): string {
  return family.trim().replace(/^(["'])(.*)\1$/, "$2");
}

// The registered name for each family the SVG embeds a font for, keyed by the
// family lowercased (CSS family names match case-insensitively).
function embeddedFamilies(styles: Element[]): Map<string, string> {
  const families = new Map<string, string>();
  for (const style of styles) {
    for (const [, face] of style.textContent!.matchAll(FONT_FACE)) {
      const family = face.match(FACE_FAMILY)?.[1];
      const data = face.match(BASE64_SRC)?.[1];
      if (!family || !data) continue;
      const key = unquote(family).toLowerCase();
      // A family split across several faces keeps its first one.
      if (!families.has(key)) families.set(key, embeddedFontFamily(data));
    }
  }
  return families;
}

// Point every font-family the SVG sets (style sheets, the presentation
// attribute, inline styles) at the registered names, so the renderer draws its
// text in the embedded fonts. Families without an embedded font stay as they are.
export function registerEmbeddedFonts(svg: Element): void {
  const styles = Array.from(svg.querySelectorAll("style"));
  const families = embeddedFamilies(styles);
  if (families.size === 0) return;

  const rename = (list: string) =>
    list
      .split(",")
      .map((family) => families.get(unquote(family).toLowerCase()) ?? family.trim())
      .join(", ");
  const renameDeclarations = (css: string) =>
    css.replace(FAMILY_DECLARATION, (_, property: string, list: string) => property + rename(list));

  for (const style of styles) style.textContent = renameDeclarations(style.textContent!);
  for (const el of svg.querySelectorAll("[font-family]")) {
    el.setAttribute("font-family", rename(el.getAttribute("font-family")!));
  }
  for (const el of svg.querySelectorAll("[style]")) {
    el.setAttribute("style", renameDeclarations(el.getAttribute("style")!));
  }
}
