import type { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { offsetForEditorLine, topVisibleLine } from "./editorLineOffsets";

const LINE_HEIGHT = 20;
const LINE_LENGTH = 10;
const LINES = 100;

// A document of uniform lines, enough of the EditorView surface for the two
// coordinate conversions under test. `documentTop` is the document's position on
// screen, so it moves opposite the scroll offset.
function fakeView(scrollTop: number, rectTop = 0, height = LINE_HEIGHT) {
  const blockFor = (line: number) => ({
    from: (line - 1) * LINE_LENGTH,
    top: (line - 1) * LINE_HEIGHT,
    height,
  });
  const clampLine = (line: number) => Math.min(Math.max(line, 1), LINES);
  return {
    scrollDOM: { scrollTop, getBoundingClientRect: () => ({ top: rectTop }) },
    documentTop: rectTop - scrollTop,
    elementAtHeight: (h: number) => blockFor(clampLine(Math.floor(h / LINE_HEIGHT) + 1)),
    lineBlockAt: (pos: number) => blockFor(clampLine(Math.floor(pos / LINE_LENGTH) + 1)),
    state: {
      doc: {
        lines: LINES,
        lineAt: (pos: number) => ({ number: clampLine(Math.floor(pos / LINE_LENGTH) + 1) }),
        line: (line: number) => ({ from: (clampLine(line) - 1) * LINE_LENGTH }),
      },
    },
  } as unknown as EditorView;
}

describe("topVisibleLine", () => {
  it("reports line 1 at the top of the document", () => {
    expect(topVisibleLine(fakeView(0))).toBe(1);
  });

  it("reports a whole line when the scroll lands on a line boundary", () => {
    expect(topVisibleLine(fakeView(40))).toBe(3);
  });

  it("reports a fraction when the top line is partly scrolled past", () => {
    expect(topVisibleLine(fakeView(50))).toBe(3.5);
  });

  it("accounts for a scroller that is not at the top of the screen", () => {
    expect(topVisibleLine(fakeView(50, 120))).toBe(3.5);
  });

  it("returns a whole line for a zero-height block rather than dividing by zero", () => {
    expect(topVisibleLine(fakeView(50, 0, 0))).toBe(3);
  });
});

describe("offsetForEditorLine", () => {
  it("puts the requested line at the top of the viewport", () => {
    expect(offsetForEditorLine(fakeView(0), 3)).toBe(40);
  });

  it("carries the fractional part into the line's own block", () => {
    expect(offsetForEditorLine(fakeView(0), 3.5)).toBe(50);
  });

  it("is unaffected by where the scroller currently sits", () => {
    expect(offsetForEditorLine(fakeView(500, 120), 3)).toBe(40);
  });

  it("clamps a line before the start of the document", () => {
    expect(offsetForEditorLine(fakeView(0), -5)).toBe(0);
  });

  it("clamps a line past the end to the bottom of the last line", () => {
    expect(offsetForEditorLine(fakeView(0), 5000)).toBe(LINES * LINE_HEIGHT);
  });

  it("puts the last line's own start at its block top", () => {
    expect(offsetForEditorLine(fakeView(0), LINES)).toBe((LINES - 1) * LINE_HEIGHT);
  });

  it("round-trips the line showing at a given offset", () => {
    const view = fakeView(50);
    expect(offsetForEditorLine(view, topVisibleLine(view))).toBe(50);
  });
});
