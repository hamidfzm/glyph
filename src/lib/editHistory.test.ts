import { describe, expect, it } from "vitest";
import { emptyHistory, MAX_HISTORY_ENTRIES, popRedo, popUndo, pushEntry } from "./editHistory";

describe("editHistory", () => {
  it("starts with empty undo and redo stacks", () => {
    expect(emptyHistory()).toEqual({ undo: [], redo: [] });
  });

  it("pushes entries onto the undo stack and clears redo", () => {
    const h0 = emptyHistory();
    const h1 = pushEntry(h0, { before: "a", after: "b" });
    expect(h1.undo).toHaveLength(1);
    expect(h1.redo).toHaveLength(0);

    // Simulate an undo so redo has content
    const popped = popUndo(h1)!;
    expect(popped.entry).toEqual({ before: "a", after: "b" });
    expect(popped.next.redo).toHaveLength(1);

    // A fresh push should clear the redo stack
    const h2 = pushEntry(popped.next, { before: "x", after: "y" });
    expect(h2.redo).toHaveLength(0);
  });

  it("caps the undo stack at MAX_HISTORY_ENTRIES, dropping oldest", () => {
    let h = emptyHistory();
    for (let i = 0; i < MAX_HISTORY_ENTRIES + 5; i++) {
      h = pushEntry(h, { before: `b${i}`, after: `a${i}` });
    }
    expect(h.undo).toHaveLength(MAX_HISTORY_ENTRIES);
    // Oldest 5 dropped, so first remaining is b5
    expect(h.undo[0].before).toBe("b5");
    expect(h.undo[h.undo.length - 1].before).toBe(`b${MAX_HISTORY_ENTRIES + 4}`);
  });

  it("popUndo moves the entry to the redo stack", () => {
    const h0 = pushEntry(emptyHistory(), { before: "a", after: "b" });
    const result = popUndo(h0)!;
    expect(result.entry).toEqual({ before: "a", after: "b" });
    expect(result.next.undo).toHaveLength(0);
    expect(result.next.redo).toEqual([{ before: "a", after: "b" }]);
  });

  it("popUndo returns null when the undo stack is empty", () => {
    expect(popUndo(emptyHistory())).toBeNull();
  });

  it("popRedo moves the entry back onto the undo stack", () => {
    const h0 = pushEntry(emptyHistory(), { before: "a", after: "b" });
    const undone = popUndo(h0)!.next;
    const result = popRedo(undone)!;
    expect(result.entry).toEqual({ before: "a", after: "b" });
    expect(result.next.undo).toEqual([{ before: "a", after: "b" }]);
    expect(result.next.redo).toHaveLength(0);
  });

  it("popRedo returns null when the redo stack is empty", () => {
    expect(popRedo(emptyHistory())).toBeNull();
  });
});
