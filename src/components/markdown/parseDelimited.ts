import { loadPapaparse } from "./lazyPapaparse";

/**
 * Parses delimited text (CSV/TSV) into rows of string cells using PapaParse,
 * an RFC 4180-compliant parser. Handles quoted fields with embedded
 * delimiters, newlines, and escaped quotes (`""`). Empty input yields `[]`.
 *
 * PapaParse is loaded lazily from its own chunk, so this resolves
 * asynchronously the first time a CSV/TSV block is rendered.
 */
export async function parseDelimited(input: string, delimiter: string): Promise<string[][]> {
  const papa = await loadPapaparse();
  return papa.parse<string[]>(input, { delimiter, skipEmptyLines: true }).data;
}
