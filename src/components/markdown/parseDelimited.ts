import Papa from "papaparse";

/**
 * Parses delimited text (CSV/TSV) into rows of string cells using PapaParse,
 * an RFC 4180-compliant parser. Handles quoted fields with embedded
 * delimiters, newlines, and escaped quotes (`""`). Empty input yields `[]`.
 */
export function parseDelimited(input: string, delimiter: string): string[][] {
  const result = Papa.parse<string[]>(input, {
    delimiter,
    skipEmptyLines: true,
  });
  return result.data;
}
