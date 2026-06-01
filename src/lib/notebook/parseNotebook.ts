// Parse a `.ipynb` JSON string into the normalized `Notebook` model in
// `./types`. Tolerant by design: notebooks in the wild mix nbformat v3 and v4,
// store `source`/text as string-or-array, and carry mimetype payloads as
// strings, arrays, or JSON objects. Anything we can't classify is dropped
// rather than throwing, so a single odd cell never blanks the whole document.
// The only hard failure is non-notebook JSON (no cells anywhere), which the
// viewer surfaces as an error state.

import {
  type CodeCell,
  type Notebook,
  type NotebookCell,
  type NotebookOutput,
  NotebookParseError,
} from "./types";

/** nbformat stores multi-line text as an array of lines; flatten to a string. */
function joinSource(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((v) => (typeof v === "string" ? v : "")).join("");
  return "";
}

/** Coerce one mimetype payload to a string: arrays join, objects stringify. */
function mimeToString(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return joinSource(value);
  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return "";
    }
  }
  return value == null ? "" : String(value);
}

function toExecutionCount(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function parseDataBundle(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [mime, payload] of Object.entries(raw as Record<string, unknown>)) {
    out[mime] = mimeToString(payload);
  }
  return out;
}

function parseOutput(raw: unknown): NotebookOutput | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  switch (o.output_type) {
    case "stream":
      return {
        kind: "stream",
        name: o.name === "stderr" ? "stderr" : "stdout",
        text: joinSource(o.text),
      };
    case "execute_result":
    case "display_data":
      return {
        kind: "data",
        data: parseDataBundle(o.data),
        executionCount: toExecutionCount(o.execution_count),
      };
    case "error":
      return {
        kind: "error",
        ename: typeof o.ename === "string" ? o.ename : "",
        evalue: typeof o.evalue === "string" ? o.evalue : "",
        traceback: Array.isArray(o.traceback)
          ? o.traceback.filter((t): t is string => typeof t === "string")
          : [],
      };
    default:
      return null;
  }
}

function parseCell(raw: unknown): NotebookCell | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  // v3 code cells store the body under `input` instead of `source`.
  const source = joinSource(c.source ?? c.input);
  switch (c.cell_type) {
    case "markdown":
      return { type: "markdown", source };
    case "raw":
      return { type: "raw", source };
    case "code": {
      const outputs = Array.isArray(c.outputs)
        ? c.outputs.map(parseOutput).filter((o): o is NotebookOutput => o !== null)
        : [];
      const cell: CodeCell = {
        type: "code",
        source,
        executionCount: toExecutionCount(c.execution_count ?? c.prompt_number),
        outputs,
      };
      return cell;
    }
    // v3 "heading" cells render fine as markdown.
    case "heading":
      return { type: "markdown", source: `${"#".repeat(Number(c.level) || 1)} ${source}` };
    default:
      return null;
  }
}

/** Pull the raw cell array from either v4 (top-level) or v3 (worksheets). */
function extractRawCells(nb: Record<string, unknown>): unknown[] {
  if (Array.isArray(nb.cells)) return nb.cells;
  if (Array.isArray(nb.worksheets)) {
    return nb.worksheets.flatMap((ws) =>
      ws && typeof ws === "object" && Array.isArray((ws as Record<string, unknown>).cells)
        ? ((ws as Record<string, unknown>).cells as unknown[])
        : [],
    );
  }
  return [];
}

function extractLanguage(nb: Record<string, unknown>): string {
  const metadata = (nb.metadata ?? {}) as Record<string, unknown>;
  const langInfo = (metadata.language_info ?? {}) as Record<string, unknown>;
  const kernelspec = (metadata.kernelspec ?? {}) as Record<string, unknown>;
  const lang = langInfo.name ?? kernelspec.language;
  return typeof lang === "string" && lang.length > 0 ? lang : "python";
}

/**
 * Parse `.ipynb` JSON text into a `Notebook`. Throws `NotebookParseError` if
 * the input isn't valid JSON or has no recognizable cells.
 */
export function parseNotebook(jsonText: string): Notebook {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new NotebookParseError(`Not valid JSON: ${err instanceof Error ? err.message : err}`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new NotebookParseError("Notebook root is not an object");
  }
  const nb = parsed as Record<string, unknown>;
  const rawCells = extractRawCells(nb);
  if (rawCells.length === 0 && !("cells" in nb) && !("worksheets" in nb)) {
    throw new NotebookParseError("File does not look like a Jupyter notebook (no cells)");
  }
  const cells = rawCells.map(parseCell).filter((c): c is NotebookCell => c !== null);
  return {
    cells,
    languageHint: extractLanguage(nb),
    nbformat: typeof nb.nbformat === "number" ? nb.nbformat : 4,
  };
}
