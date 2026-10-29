import { describe, expect, it } from "vitest";
import { bytesToBase64 } from "@/lib/base64";
import { embeddedFontFamily, embeddedFontsReady } from "./embeddedFonts";
import { pdfEngine } from "./pdfEngine";

const font = (...bytes: number[]) => bytesToBase64(new Uint8Array(bytes));

describe("embeddedFontFamily", () => {
  it("registers a font with pdfmake under the family it returns, in every style slot", async () => {
    const family = embeddedFontFamily(font(0, 1, 0, 0, 1));
    await embeddedFontsReady();
    expect(pdfEngine().fonts[family]).toEqual({
      normal: family,
      bold: family,
      italics: family,
      bolditalics: family,
    });
  });

  it("returns one family for the same data and another for different data", () => {
    const data = font(0, 1, 0, 0, 2);
    expect(embeddedFontFamily(data)).toBe(embeddedFontFamily(data));
    expect(embeddedFontFamily(font(0, 1, 0, 0, 3))).not.toBe(embeddedFontFamily(data));
  });

  it("leaves a WOFF2 font unregistered, so its text keeps the default font", async () => {
    const family = embeddedFontFamily(font(0x77, 0x4f, 0x46, 0x32, 0, 0));
    await embeddedFontsReady();
    expect(pdfEngine().fonts[family]).toBeUndefined();
  });

  it("leaves data that is not base64 unregistered", async () => {
    const family = embeddedFontFamily("not base64!");
    await embeddedFontsReady();
    expect(pdfEngine().fonts[family]).toBeUndefined();
  });
});
