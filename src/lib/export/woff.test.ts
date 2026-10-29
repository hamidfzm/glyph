import { describe, expect, it } from "vitest";
import { buildWoff, fourCC } from "@/test/woff";
import { toSfnt } from "./woff";

const filled = (length: number, value: number) => new Uint8Array(length).fill(value);

describe("toSfnt", () => {
  it("passes a TrueType or OpenType font through as it is", async () => {
    for (const version of [fourCC("true"), fourCC("OTTO"), 0x00010000]) {
      const font = new Uint8Array(8);
      new DataView(font.buffer).setUint32(0, version);
      expect(await toSfnt(font)).toBe(font);
    }
  });

  it("refuses data that is no font pdfkit can open, so its text keeps the default font", async () => {
    await expect(toSfnt(new TextEncoder().encode("<svg/>"))).rejects.toThrow(TypeError);
    // Too short to carry a signature at all.
    await expect(toSfnt(new Uint8Array([0x77, 0x4f]))).rejects.toThrow(TypeError);
  });

  it("unpacks compressed and stored tables into an sfnt", async () => {
    const cmap = filled(300, 7);
    const glyf = new Uint8Array([1, 2, 3, 4, 5]);
    const head = filled(54, 9);
    const sfnt = await toSfnt(
      buildWoff([
        { tag: "cmap", data: cmap, compress: true },
        { tag: "glyf", data: glyf },
        { tag: "head", data: head, compress: true },
      ]),
    );
    const view = new DataView(sfnt.buffer);
    expect(view.getUint32(0)).toBe(0x00010000);
    expect(view.getUint16(4)).toBe(3);
    // Binary-search fields for three tables: searchRange, entrySelector, rangeShift.
    expect([view.getUint16(6), view.getUint16(8), view.getUint16(10)]).toEqual([32, 1, 16]);

    const expected = [cmap, glyf, head];
    let offset = 12 + 16 * 3;
    expected.forEach((data, i) => {
      const record = 12 + 16 * i;
      expect(view.getUint32(record)).toBe(fourCC(["cmap", "glyf", "head"][i]));
      expect(view.getUint32(record + 4)).toBe(i);
      expect(view.getUint32(record + 8)).toBe(offset);
      expect(view.getUint32(record + 12)).toBe(data.length);
      expect(sfnt.subarray(offset, offset + data.length)).toEqual(data);
      // Each table starts on a four-byte boundary.
      offset += (data.length + 3) & ~3;
    });
    expect(sfnt.length).toBe(offset);
  });

  it("rejects WOFF2, whose glyphs pdfkit would draw empty", async () => {
    await expect(toSfnt(buildWoff([], "wOF2"))).rejects.toThrow(TypeError);
  });

  it("rejects a table that inflates past its declared size", async () => {
    const font = buildWoff([
      { tag: "glyf", data: filled(4096, 1), compress: true, declaredLength: 1000 },
    ]);
    await expect(toSfnt(font)).rejects.toThrow("size cap");
  });

  it("rejects a table that inflates short of its declared size", async () => {
    const font = buildWoff([
      { tag: "glyf", data: filled(100, 1), compress: true, declaredLength: 200 },
    ]);
    await expect(toSfnt(font)).rejects.toThrow("size mismatch");
  });

  it("refuses a font declaring more than the cap before inflating anything", async () => {
    // A small table claiming 64 MiB: a decompression bomb would claim as much.
    const font = buildWoff([
      { tag: "glyf", data: filled(64, 0), compress: true, declaredLength: 64 * 1024 * 1024 },
    ]);
    await expect(toSfnt(font)).rejects.toThrow("size cap");
  });

  it("rejects a table that points past the end of the file", async () => {
    const font = buildWoff([{ tag: "glyf", data: filled(8, 1) }]);
    new DataView(font.buffer).setUint32(44 + 4, font.length);
    await expect(toSfnt(font)).rejects.toThrow("out of bounds");
  });

  it("rejects a truncated WOFF header", async () => {
    await expect(toSfnt(buildWoff([]).subarray(0, 8))).rejects.toThrow(RangeError);
  });
});
