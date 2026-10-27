// Fonts that SVGs embed, registered with pdfmake so SVG text can be drawn in
// them (see svgFonts). A font is named as the walker meets it, synchronously,
// and registered in the background; a PDF build awaits `embeddedFontsReady`
// before it starts.

import { base64ToBytes, bytesToBase64 } from "@/lib/base64";
import { pdfEngine } from "./pdfEngine";
import { toSfnt } from "./woff";

interface EmbeddedFont {
  family: string;
  ready: Promise<void>;
}

// By font data (base64): the same font, as when the same diagram is exported
// again, registers once per session.
const fonts = new Map<string, EmbeddedFont>();

async function register(family: string, base64: string): Promise<void> {
  try {
    const bytes = base64ToBytes(base64);
    const sfnt = await toSfnt(bytes);
    const engine = pdfEngine();
    engine.addVirtualFileSystem({ [family]: sfnt === bytes ? base64 : bytesToBase64(sfnt) });
    // Every style slot: the text asks for the face by name, and pdfmake rejects
    // a bold or italic lookup in a family that lacks that slot.
    engine.addFonts({
      [family]: { normal: family, bold: family, italics: family, bolditalics: family },
    });
  } catch {
    // Left unregistered, text in this font falls back to the default font.
  }
}

/** The family name SVG text uses to draw in the font with this base64 data. */
export function embeddedFontFamily(base64: string): string {
  let font = fonts.get(base64);
  if (font === undefined) {
    const family = `glyph-embedded-${fonts.size}`;
    font = { family, ready: register(family, base64) };
    fonts.set(base64, font);
  }
  return font.family;
}

export async function embeddedFontsReady(): Promise<void> {
  await Promise.all(Array.from(fonts.values(), (font) => font.ready));
}
