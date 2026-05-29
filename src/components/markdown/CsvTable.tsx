import { useMemo } from "react";
import { parseDelimited } from "./parseDelimited";

interface CsvTableProps {
  code: string;
  delimiter: "," | "\t";
}

/**
 * Renders a CSV/TSV fenced code block as a styled table. The first row is
 * treated as the header. Falls back to the raw code fence if the data can't
 * be parsed into at least one row.
 */
export function CsvTable({ code, delimiter }: CsvTableProps) {
  const rows = useMemo(() => parseDelimited(code, delimiter), [code, delimiter]);

  if (rows.length === 0) {
    return (
      <pre>
        <code>{code}</code>
      </pre>
    );
  }

  const [header, ...body] = rows;
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);

  return (
    <div className="csv-table-wrapper">
      <table className="csv-table">
        <thead>
          <tr>
            {Array.from({ length: columnCount }, (_, col) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: column position is stable
              <th key={col} scope="col">
                {header[col] ?? ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, rowIndex) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable id
            <tr key={rowIndex}>
              {Array.from({ length: columnCount }, (_, col) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: column position is stable
                <td key={col}>{row[col] ?? ""}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
