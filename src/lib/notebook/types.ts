// Normalized Jupyter notebook model. The on-disk `.ipynb` JSON (nbformat v3/v4)
// is messy — `source` and output text come as either a string or an array of
// line-strings, mimetype payloads can be strings, arrays, or JSON objects, and
// v3 nests cells under `worksheets`. `parseNotebook` flattens all of that into
// the shapes below so the renderer never has to branch on wire-format quirks.

/** A single output attached to a code cell, normalized by output kind. */
export type NotebookOutput = StreamOutput | DataOutput | ErrorOutput;

/** `stream` output — stdout/stderr text, possibly carrying ANSI escapes. */
export interface StreamOutput {
  kind: "stream";
  /** `stdout` or `stderr`; anything unknown is treated as stdout. */
  name: "stdout" | "stderr";
  text: string;
}

/**
 * `execute_result` / `display_data` output. `data` maps a MIME type to its
 * payload as a string (arrays joined, JSON objects stringified). Binary image
 * payloads (`image/png`, `image/jpeg`) keep their base64 string verbatim.
 */
export interface DataOutput {
  kind: "data";
  data: Record<string, string>;
  /** Execution count for `execute_result`; null for `display_data`. */
  executionCount: number | null;
}

/** `error` output — an exception with a (usually ANSI-coloured) traceback. */
export interface ErrorOutput {
  kind: "error";
  ename: string;
  evalue: string;
  /** Traceback frames; join with "\n" to reconstruct the printed trace. */
  traceback: string[];
}

export type NotebookCell = MarkdownCell | CodeCell | RawCell;

export interface MarkdownCell {
  type: "markdown";
  source: string;
}

export interface CodeCell {
  type: "code";
  source: string;
  /** `In [n]` counter; null for never-run / cleared cells. */
  executionCount: number | null;
  outputs: NotebookOutput[];
}

export interface RawCell {
  type: "raw";
  source: string;
}

export interface Notebook {
  cells: NotebookCell[];
  /**
   * Language for syntax-highlighting code cells, derived from
   * `metadata.language_info.name` / `metadata.kernelspec.language`. Defaults to
   * `"python"` since that's the overwhelming majority of notebooks.
   */
  languageHint: string;
  /** Major nbformat version (4 for modern notebooks, 3 for legacy). */
  nbformat: number;
}

/** Thrown when a file is not valid notebook JSON. */
export class NotebookParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotebookParseError";
  }
}
