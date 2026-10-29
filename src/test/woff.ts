import { deflateSync } from "node:zlib";

export interface WoffTable {
  tag: string;
  data: Uint8Array;
  compress?: boolean;
  // Overrides the size the directory declares for the unpacked table.
  declaredLength?: number;
  checksum?: number;
}

export const fourCC = (text: string) =>
  new DataView(new TextEncoder().encode(text).buffer).getUint32(0);

/** A WOFF 1.0 file around the given tables, as a font file or a CSS data URL carries one. */
export function buildWoff(
  tables: WoffTable[],
  signature = "wOFF",
  flavor = 0x00010000,
): Uint8Array {
  // WOFF stores a table as is when deflating does not make it smaller.
  const stored = tables.map((t) => {
    const deflated = t.compress ? new Uint8Array(deflateSync(t.data)) : t.data;
    return deflated.length < t.data.length ? deflated : t.data;
  });
  let offset = 44 + 20 * tables.length;
  const offsets = stored.map((data) => {
    const at = offset;
    offset += (data.length + 3) & ~3;
    return at;
  });
  const bytes = new Uint8Array(offset);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, fourCC(signature));
  view.setUint32(4, flavor);
  view.setUint16(12, tables.length);
  tables.forEach((t, i) => {
    const entry = 44 + 20 * i;
    view.setUint32(entry, fourCC(t.tag));
    view.setUint32(entry + 4, offsets[i]);
    view.setUint32(entry + 8, stored[i].length);
    view.setUint32(entry + 12, t.declaredLength ?? t.data.length);
    view.setUint32(entry + 16, t.checksum ?? i);
    bytes.set(stored[i], offsets[i]);
  });
  return bytes;
}
