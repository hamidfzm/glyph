/**
 * Minimal RFC 4180-style parser for delimited text (CSV/TSV).
 * Handles quoted fields with embedded delimiters, newlines, and escaped
 * quotes (`""`). Returns rows of string cells. Empty input yields `[]`.
 */
export function parseDelimited(input: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let started = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
    started = false;
  };

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    started = true;

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      pushField();
    } else if (char === "\n") {
      pushRow();
    } else if (char === "\r") {
      // swallow; the following \n (if any) finalizes the row
    } else {
      field += char;
    }
  }

  // Flush trailing field/row unless the input ended on a clean row break.
  if (started || field.length > 0 || row.length > 0) {
    pushRow();
  }

  return rows;
}
