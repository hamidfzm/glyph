import { describe, expect, it } from "vitest";
import { parseNotebook } from "./parseNotebook";
import { NotebookParseError } from "./types";

function nb(cells: unknown[], metadata?: unknown): string {
  return JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata, cells });
}

describe("parseNotebook", () => {
  it("parses a markdown cell, joining array source", () => {
    const result = parseNotebook(nb([{ cell_type: "markdown", source: ["# Title\n", "body"] }]));
    expect(result.cells).toEqual([{ type: "markdown", source: "# Title\nbody" }]);
  });

  it("parses a code cell with execution count and stream output", () => {
    const result = parseNotebook(
      nb([
        {
          cell_type: "code",
          execution_count: 3,
          source: "print('hi')",
          outputs: [{ output_type: "stream", name: "stdout", text: ["hi\n"] }],
        },
      ]),
    );
    expect(result.cells[0]).toEqual({
      type: "code",
      source: "print('hi')",
      executionCount: 3,
      outputs: [{ kind: "stream", name: "stdout", text: "hi\n" }],
    });
  });

  it("normalizes execute_result data bundles", () => {
    const result = parseNotebook(
      nb([
        {
          cell_type: "code",
          execution_count: 1,
          source: "1+1",
          outputs: [
            {
              output_type: "execute_result",
              execution_count: 1,
              data: { "text/plain": ["2"], "text/html": "<b>2</b>" },
            },
          ],
        },
      ]),
    );
    const out = result.cells[0];
    expect(out.type).toBe("code");
    if (out.type === "code") {
      expect(out.outputs[0]).toEqual({
        kind: "data",
        data: { "text/plain": "2", "text/html": "<b>2</b>" },
        executionCount: 1,
      });
    }
  });

  it("keeps base64 image payloads verbatim", () => {
    const result = parseNotebook(
      nb([
        {
          cell_type: "code",
          source: "",
          outputs: [{ output_type: "display_data", data: { "image/png": "AAAA" } }],
        },
      ]),
    );
    const out = result.cells[0];
    if (out.type === "code" && out.outputs[0].kind === "data") {
      expect(out.outputs[0].data["image/png"]).toBe("AAAA");
    }
  });

  it("stringifies JSON object mimetype payloads", () => {
    const result = parseNotebook(
      nb([
        {
          cell_type: "code",
          source: "",
          outputs: [
            {
              output_type: "execute_result",
              data: { "application/json": { a: 1 } },
            },
          ],
        },
      ]),
    );
    const out = result.cells[0];
    if (out.type === "code" && out.outputs[0].kind === "data") {
      expect(out.outputs[0].data["application/json"]).toContain('"a": 1');
    }
  });

  it("parses error outputs with traceback", () => {
    const result = parseNotebook(
      nb([
        {
          cell_type: "code",
          source: "1/0",
          outputs: [
            {
              output_type: "error",
              ename: "ZeroDivisionError",
              evalue: "division by zero",
              traceback: ["Traceback", "ZeroDivisionError: division by zero"],
            },
          ],
        },
      ]),
    );
    const out = result.cells[0];
    if (out.type === "code" && out.outputs[0].kind === "error") {
      expect(out.outputs[0].ename).toBe("ZeroDivisionError");
      expect(out.outputs[0].traceback).toHaveLength(2);
    }
  });

  it("derives language from language_info then kernelspec", () => {
    expect(parseNotebook(nb([], { language_info: { name: "rust" } })).languageHint).toBe("rust");
    expect(parseNotebook(nb([], { kernelspec: { language: "julia" } })).languageHint).toBe("julia");
    expect(parseNotebook(nb([])).languageHint).toBe("python");
  });

  it("drops unknown cell and output types instead of throwing", () => {
    const result = parseNotebook(
      nb([
        { cell_type: "mystery", source: "x" },
        {
          cell_type: "code",
          source: "",
          outputs: [{ output_type: "weird" }, { output_type: "stream", text: "ok" }],
        },
      ]),
    );
    expect(result.cells).toHaveLength(1);
    const out = result.cells[0];
    if (out.type === "code") {
      expect(out.outputs).toHaveLength(1);
    }
  });

  it("reads v3 worksheets, input field, and prompt_number", () => {
    const v3 = JSON.stringify({
      nbformat: 3,
      worksheets: [
        {
          cells: [
            { cell_type: "code", input: ["x = 1"], prompt_number: 7, outputs: [] },
            { cell_type: "heading", level: 2, source: "Section" },
          ],
        },
      ],
    });
    const result = parseNotebook(v3);
    expect(result.nbformat).toBe(3);
    expect(result.cells[0]).toMatchObject({ type: "code", source: "x = 1", executionCount: 7 });
    expect(result.cells[1]).toEqual({ type: "markdown", source: "## Section" });
  });

  it("parses a v4 raw cell", () => {
    const result = parseNotebook(nb([{ cell_type: "raw", source: ["raw text"] }]));
    expect(result.cells[0]).toEqual({ type: "raw", source: "raw text" });
  });

  it("coerces a non-string/non-array source to an empty string", () => {
    const result = parseNotebook(nb([{ cell_type: "markdown", source: 42 }]));
    expect(result.cells[0]).toEqual({ type: "markdown", source: "" });
  });

  it("stringifies a numeric mimetype payload via String()", () => {
    const result = parseNotebook(
      nb([
        {
          cell_type: "code",
          source: "",
          outputs: [{ output_type: "execute_result", data: { "text/plain": 7 } }],
        },
      ]),
    );
    const out = result.cells[0];
    if (out.type === "code" && out.outputs[0].kind === "data") {
      expect(out.outputs[0].data["text/plain"]).toBe("7");
    }
  });

  it("throws on invalid JSON", () => {
    expect(() => parseNotebook("{not json")).toThrow(NotebookParseError);
  });

  it("throws on JSON that is not a notebook", () => {
    expect(() => parseNotebook(JSON.stringify({ foo: "bar" }))).toThrow(NotebookParseError);
  });

  it("accepts an empty but well-formed notebook", () => {
    expect(parseNotebook(nb([])).cells).toEqual([]);
  });

  it("throws when the root JSON is not an object", () => {
    expect(() => parseNotebook("42")).toThrow(NotebookParseError);
    expect(() => parseNotebook("null")).toThrow(NotebookParseError);
  });

  it("defaults nbformat to 4 when missing or non-numeric", () => {
    const noVersion = JSON.stringify({ cells: [] });
    expect(parseNotebook(noVersion).nbformat).toBe(4);
  });

  it("drops non-object cells and outputs", () => {
    const json = JSON.stringify({
      nbformat: 4,
      cells: [
        null,
        "not a cell",
        {
          cell_type: "code",
          source: "x",
          outputs: [null, 5, { output_type: "stream", text: "ok" }],
        },
      ],
    });
    const result = parseNotebook(json);
    expect(result.cells).toHaveLength(1);
    const out = result.cells[0];
    if (out.type === "code") expect(out.outputs).toHaveLength(1);
  });

  it("treats a non-array outputs field as empty", () => {
    const result = parseNotebook(nb([{ cell_type: "code", source: "x", outputs: "oops" }]));
    const out = result.cells[0];
    if (out.type === "code") expect(out.outputs).toEqual([]);
  });

  it("classifies stderr stream output by name", () => {
    const result = parseNotebook(
      nb([
        {
          cell_type: "code",
          source: "",
          outputs: [{ output_type: "stream", name: "stderr", text: "boom" }],
        },
      ]),
    );
    const out = result.cells[0];
    if (out.type === "code" && out.outputs[0].kind === "stream") {
      expect(out.outputs[0].name).toBe("stderr");
    }
  });

  it("defaults error fields when missing", () => {
    const result = parseNotebook(
      nb([{ cell_type: "code", source: "", outputs: [{ output_type: "error" }] }]),
    );
    const out = result.cells[0];
    if (out.type === "code" && out.outputs[0].kind === "error") {
      expect(out.outputs[0].ename).toBe("");
      expect(out.outputs[0].evalue).toBe("");
      expect(out.outputs[0].traceback).toEqual([]);
    }
  });

  it("renders a v3 heading cell with a default level when level is missing", () => {
    const result = parseNotebook(nb([{ cell_type: "heading", source: "Title" }]));
    expect(result.cells[0]).toEqual({ type: "markdown", source: "# Title" });
  });

  it("ignores worksheets entries that lack a cells array", () => {
    const json = JSON.stringify({
      nbformat: 3,
      worksheets: [null, { foo: 1 }, { cells: [{ cell_type: "markdown", source: "hi" }] }],
    });
    const result = parseNotebook(json);
    expect(result.cells).toEqual([{ type: "markdown", source: "hi" }]);
  });

  it("coerces non-string array source elements to empty strings", () => {
    // joinSource maps a non-string array element to "" before joining.
    const result = parseNotebook(nb([{ cell_type: "markdown", source: ["a", 5, "b"] }]));
    expect(result.cells[0]).toEqual({ type: "markdown", source: "ab" });
  });

  it("renders a null mimetype payload as an empty string", () => {
    // mimeToString hits the `value == null ? "" : String(value)` null arm.
    const result = parseNotebook(
      nb([
        {
          cell_type: "code",
          source: "",
          outputs: [{ output_type: "execute_result", data: { "text/plain": null } }],
        },
      ]),
    );
    const out = result.cells[0];
    if (out.type === "code" && out.outputs[0].kind === "data") {
      expect(out.outputs[0].data["text/plain"]).toBe("");
    }
  });

  it("ignores a non-array source/value in cells and outputs", () => {
    // joinSource on a number → "", parseDataBundle on a non-object → {}.
    const result = parseNotebook(
      nb([
        { cell_type: "markdown", source: 5 },
        { cell_type: "code", source: "", outputs: [{ output_type: "execute_result", data: 7 }] },
      ]),
    );
    expect(result.cells[0]).toEqual({ type: "markdown", source: "" });
    const out = result.cells[1];
    if (out.type === "code" && out.outputs[0].kind === "data") {
      expect(out.outputs[0].data).toEqual({});
    }
  });
});
