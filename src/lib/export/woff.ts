// pdfkit reads fonts with fontkit, whose WOFF inflater rejects some valid
// streams (D2's italic font is one), so a WOFF font is unpacked to the plain
// TrueType/OpenType font it wraps with the browser's own inflate first.

import { chunked, collect } from "@/lib/byteStreams";

const WOFF_SIGNATURE = 0x774f4646; // "wOFF"
// TrueType ("\0\1\0\0", "true") and CFF ("OTTO") outlines. Not WOFF2: pdfkit's
// subsetter copies its transformed glyf table as is, drawing every glyph empty,
// and rebuilding it would need a brotli decoder, which DecompressionStream lacks.
const SFNT_VERSIONS = new Set([0x00010000, 0x74727565, 0x4f54544f]);
const WOFF_HEADER_BYTES = 44;
const WOFF_ENTRY_BYTES = 20;
const SFNT_HEADER_BYTES = 12;
const SFNT_ENTRY_BYTES = 16;
// The font comes from the document: refuse one that claims to unpack past this.
const MAX_FONT_BYTES = 32 * 1024 * 1024;

interface Table {
  tag: number;
  checksum: number;
  data: Uint8Array;
}

const padded = (length: number) => (length + 3) & ~3;

async function readTable(woff: Uint8Array, view: DataView, entry: number): Promise<Table> {
  const offset = view.getUint32(entry + 4);
  const storedLength = view.getUint32(entry + 8);
  const length = view.getUint32(entry + 12);
  if (offset + storedLength > woff.length) throw new RangeError("WOFF table out of bounds");
  const stored = woff.subarray(offset, offset + storedLength);
  const data =
    storedLength < length
      ? await collect(chunked(stored).pipeThrough(new DecompressionStream("deflate")), length)
      : stored;
  if (data.length !== length) throw new RangeError("WOFF table size mismatch");
  return { tag: view.getUint32(entry), checksum: view.getUint32(entry + 16), data };
}

const signatureOf = (font: Uint8Array) =>
  font.length < 4 ? 0 : new DataView(font.buffer, font.byteOffset, 4).getUint32(0);

/**
 * The TrueType or OpenType font pdfkit can draw: a WOFF font unpacked, a plain
 * one as it is. Throws on anything else, WOFF2 included, and on a malformed WOFF.
 */
export async function toSfnt(font: Uint8Array): Promise<Uint8Array> {
  const sfnt = signatureOf(font) === WOFF_SIGNATURE ? await unpackWoff(font) : font;
  if (!SFNT_VERSIONS.has(signatureOf(sfnt))) throw new TypeError("not a TrueType or OpenType font");
  return sfnt;
}

async function unpackWoff(font: Uint8Array): Promise<Uint8Array> {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const count = view.getUint16(12);
  const entries = Array.from({ length: count }, (_, i) => WOFF_HEADER_BYTES + i * WOFF_ENTRY_BYTES);
  // Checked before inflating anything; each table then inflates to at most its declared length.
  const declared = entries.reduce((sum, entry) => sum + view.getUint32(entry + 12), 0);
  if (declared > MAX_FONT_BYTES) throw new RangeError("WOFF font over the size cap");
  const tables: Table[] = [];
  for (const entry of entries) tables.push(await readTable(font, view, entry));

  let offset = SFNT_HEADER_BYTES + count * SFNT_ENTRY_BYTES;
  const size = tables.reduce((sum, table) => sum + padded(table.data.length), offset);
  const sfnt = new Uint8Array(size);
  const out = new DataView(sfnt.buffer);
  const entrySelector = Math.floor(Math.log2(Math.max(count, 1)));
  const searchRange = SFNT_ENTRY_BYTES << entrySelector;
  out.setUint32(0, view.getUint32(4)); // the wrapped font's sfnt version
  out.setUint16(4, count);
  out.setUint16(6, searchRange);
  out.setUint16(8, entrySelector);
  out.setUint16(10, count * SFNT_ENTRY_BYTES - searchRange);
  tables.forEach((table, i) => {
    const entry = SFNT_HEADER_BYTES + i * SFNT_ENTRY_BYTES;
    out.setUint32(entry, table.tag);
    out.setUint32(entry + 4, table.checksum);
    out.setUint32(entry + 8, offset);
    out.setUint32(entry + 12, table.data.length);
    sfnt.set(table.data, offset);
    offset += padded(table.data.length);
  });
  return sfnt;
}
