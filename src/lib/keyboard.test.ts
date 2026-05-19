import { describe, expect, it } from "vitest";
import {
  KEYBOARD_EVENT,
  matchesCommandPaletteShortcut,
  matchesRedoShortcut,
  matchesUndoShortcut,
} from "./keyboard";

function makeEvent(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent(KEYBOARD_EVENT.KeyDown, init);
}

describe("matchesUndoShortcut", () => {
  it("matches Cmd+Z on macOS", () => {
    expect(matchesUndoShortcut(makeEvent({ key: "z", metaKey: true }), "macos")).toBe(true);
  });

  it("matches Ctrl+Z on windows and linux", () => {
    expect(matchesUndoShortcut(makeEvent({ key: "z", ctrlKey: true }), "windows")).toBe(true);
    expect(matchesUndoShortcut(makeEvent({ key: "z", ctrlKey: true }), "linux")).toBe(true);
  });

  it("rejects Cmd+Z when shift or alt are held", () => {
    expect(
      matchesUndoShortcut(makeEvent({ key: "z", metaKey: true, shiftKey: true }), "macos"),
    ).toBe(false);
    expect(matchesUndoShortcut(makeEvent({ key: "z", metaKey: true, altKey: true }), "macos")).toBe(
      false,
    );
  });

  it("rejects unrelated keys", () => {
    expect(matchesUndoShortcut(makeEvent({ key: "a", metaKey: true }), "macos")).toBe(false);
  });

  it("rejects the wrong platform modifier", () => {
    expect(matchesUndoShortcut(makeEvent({ key: "z", ctrlKey: true }), "macos")).toBe(false);
    expect(matchesUndoShortcut(makeEvent({ key: "z", metaKey: true }), "windows")).toBe(false);
  });
});

describe("matchesRedoShortcut", () => {
  it("matches Shift+Cmd+Z on macOS", () => {
    expect(
      matchesRedoShortcut(makeEvent({ key: "z", metaKey: true, shiftKey: true }), "macos"),
    ).toBe(true);
  });

  it("matches Shift+Ctrl+Z and Ctrl+Y on windows and linux", () => {
    expect(
      matchesRedoShortcut(makeEvent({ key: "z", ctrlKey: true, shiftKey: true }), "windows"),
    ).toBe(true);
    expect(matchesRedoShortcut(makeEvent({ key: "y", ctrlKey: true }), "windows")).toBe(true);
    expect(matchesRedoShortcut(makeEvent({ key: "y", ctrlKey: true }), "linux")).toBe(true);
  });

  it("does not match Cmd+Y on macOS (reserved by the OS)", () => {
    expect(matchesRedoShortcut(makeEvent({ key: "y", metaKey: true }), "macos")).toBe(false);
  });

  it("rejects plain Cmd+Z without shift", () => {
    expect(matchesRedoShortcut(makeEvent({ key: "z", metaKey: true }), "macos")).toBe(false);
  });
});

describe("matchesCommandPaletteShortcut", () => {
  it("matches Cmd+K on macOS", () => {
    expect(matchesCommandPaletteShortcut(makeEvent({ key: "k", metaKey: true }), "macos")).toBe(
      true,
    );
  });

  it("matches Ctrl+K on windows and linux", () => {
    expect(matchesCommandPaletteShortcut(makeEvent({ key: "k", ctrlKey: true }), "windows")).toBe(
      true,
    );
    expect(matchesCommandPaletteShortcut(makeEvent({ key: "k", ctrlKey: true }), "linux")).toBe(
      true,
    );
  });

  it("rejects when shift or alt is held", () => {
    expect(
      matchesCommandPaletteShortcut(
        makeEvent({ key: "k", metaKey: true, shiftKey: true }),
        "macos",
      ),
    ).toBe(false);
    expect(
      matchesCommandPaletteShortcut(makeEvent({ key: "k", metaKey: true, altKey: true }), "macos"),
    ).toBe(false);
  });

  it("rejects the wrong platform modifier", () => {
    expect(matchesCommandPaletteShortcut(makeEvent({ key: "k", ctrlKey: true }), "macos")).toBe(
      false,
    );
  });
});
