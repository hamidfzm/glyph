import { describe, expect, it } from "vitest";
import {
  incompleteIndex,
  MAX_SHOWN_CHARS,
  prettyJson,
  shownResult,
  toolCallSubject,
} from "@/lib/ai/toolCallDisplay";

const truncated = { truncated: true, reason: "fileLimit", limit: 20000 };
const complete = { truncated: false, reason: null, limit: null };

describe("toolCallSubject", () => {
  it("names the note, board, or tag a call was about", () => {
    expect(toolCallSubject({ ref: "Cooking" })).toBe("Cooking");
    expect(toolCallSubject({ path: "Board.canvas" })).toBe("Board.canvas");
    expect(toolCallSubject({ tag: "work" })).toBe("work");
  });

  it("names nothing for a call without one, or with arguments that are not an object", () => {
    expect(toolCallSubject({})).toBeNull();
    expect(toolCallSubject({ ref: 42 })).toBeNull();
    expect(toolCallSubject('{"ref": ')).toBeNull();
    expect(toolCallSubject(null)).toBeNull();
  });
});

describe("prettyJson and shownResult", () => {
  it("indents JSON and leaves other text as it is", () => {
    expect(prettyJson({ ref: "Index" })).toBe('{\n  "ref": "Index"\n}');
    expect(prettyJson('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(prettyJson("no vault is open")).toBe("no vault is open");
  });

  it("cuts a long result and says how much there was", () => {
    const long = "x".repeat(MAX_SHOWN_CHARS + 5);
    expect(shownResult(long)).toEqual({
      text: "x".repeat(MAX_SHOWN_CHARS),
      total: MAX_SHOWN_CHARS + 5,
      cut: true,
    });
    expect(shownResult("short")).toEqual({ text: "short", total: 5, cut: false });
  });
});

describe("incompleteIndex", () => {
  it("finds a result's own truncated status", () => {
    expect(incompleteIndex(JSON.stringify({ status: truncated }))).toEqual(truncated);
  });

  it("finds a truncated vault in vault_context's list", () => {
    const context = {
      vaults: [
        { root: "/a", status: complete },
        { root: "/b", status: truncated },
      ],
    };
    expect(incompleteIndex(JSON.stringify(context))).toEqual(truncated);
  });

  it("reports nothing for a complete index, a refusal, or a vault that errored", () => {
    expect(incompleteIndex(JSON.stringify({ status: complete }))).toBeNull();
    expect(incompleteIndex("no vault is open: open a folder")).toBeNull();
    expect(incompleteIndex(JSON.stringify({ vaults: [{ root: "/a", error: "gone" }] }))).toBeNull();
    expect(incompleteIndex("null")).toBeNull();
  });
});
