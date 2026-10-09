import { describe, expect, it } from "vitest";
import {
  formatAccelerator,
  hasCommandModifier,
  matchesAccelerator,
  parseAccelerator,
  parseKeyEvent,
  serializeAccelerator,
} from "./accelerator";

function kd(
  code: string,
  mods: { meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean } = {},
): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    code,
    metaKey: !!mods.meta,
    ctrlKey: !!mods.ctrl,
    altKey: !!mods.alt,
    shiftKey: !!mods.shift,
  });
}

describe("parseAccelerator", () => {
  it("parses a single-modifier accelerator", () => {
    expect(parseAccelerator("CmdOrCtrl+O")).toEqual({
      cmdOrCtrl: true,
      alt: false,
      shift: false,
      key: "O",
    });
  });

  it("normalizes a lowercase key and modifier aliases", () => {
    expect(parseAccelerator("Cmd+o")).toEqual({
      cmdOrCtrl: true,
      alt: false,
      shift: false,
      key: "O",
    });
  });

  it("parses multiple modifiers and a symbol key", () => {
    expect(parseAccelerator("Alt+Shift+,")).toEqual({
      cmdOrCtrl: false,
      alt: true,
      shift: true,
      key: ",",
    });
  });

  it("returns null for a modifier-only string", () => {
    expect(parseAccelerator("CmdOrCtrl")).toBeNull();
  });

  it("returns null when two non-modifier keys are present", () => {
    expect(parseAccelerator("CmdOrCtrl+O+P")).toBeNull();
  });
});

describe("parseKeyEvent", () => {
  // The event as the accelerator a recorded shortcut is stored under.
  function recorded(event: KeyboardEvent): string | null {
    const parsed = parseKeyEvent(event);
    return parsed && serializeAccelerator(parsed);
  }

  it("reads the modifiers and the key of a keydown", () => {
    expect(parseKeyEvent(kd("KeyO", { meta: true }))).toEqual({
      cmdOrCtrl: true,
      alt: false,
      shift: false,
      key: "O",
    });
  });

  it("includes Alt and Shift and maps digits", () => {
    expect(recorded(kd("Digit5", { ctrl: true, shift: true }))).toBe("CmdOrCtrl+Shift+5");
  });

  it("maps punctuation codes to their tokens", () => {
    expect(recorded(kd("Backslash", { meta: true }))).toBe("CmdOrCtrl+\\");
    expect(recorded(kd("Equal", { ctrl: true }))).toBe("CmdOrCtrl+=");
    expect(recorded(kd("Comma", { alt: true }))).toBe("Alt+,");
  });

  it("returns null when only modifier keys are held", () => {
    expect(parseKeyEvent(kd("ShiftLeft", { shift: true }))).toBeNull();
    expect(parseKeyEvent(kd("MetaLeft", { meta: true }))).toBeNull();
  });

  it("maps function keys", () => {
    expect(recorded(kd("F5", { ctrl: true }))).toBe("CmdOrCtrl+F5");
  });
});

describe("serializeAccelerator", () => {
  it("spells the modifiers in one order, whatever order they were written in", () => {
    const parsed = parseAccelerator("Shift+Alt+Ctrl+t");
    expect(parsed && serializeAccelerator(parsed)).toBe("CmdOrCtrl+Alt+Shift+T");
  });

  it("writes a bare key as the key alone", () => {
    expect(serializeAccelerator({ cmdOrCtrl: false, alt: false, shift: false, key: "F5" })).toBe(
      "F5",
    );
  });
});

describe("hasCommandModifier", () => {
  const bare = { cmdOrCtrl: false, alt: false, shift: false, key: "A" };

  it("holds for Cmd/Ctrl or Alt", () => {
    expect(hasCommandModifier({ ...bare, cmdOrCtrl: true })).toBe(true);
    expect(hasCommandModifier({ ...bare, alt: true })).toBe(true);
  });

  it("does not hold for a bare key, or one with Shift alone", () => {
    expect(hasCommandModifier(bare)).toBe(false);
    expect(hasCommandModifier({ ...bare, shift: true })).toBe(false);
  });
});

describe("matchesAccelerator", () => {
  it("matches CmdOrCtrl against Cmd on macOS and Ctrl elsewhere", () => {
    expect(matchesAccelerator(kd("KeyO", { meta: true }), "CmdOrCtrl+O", "macos")).toBe(true);
    expect(matchesAccelerator(kd("KeyO", { ctrl: true }), "CmdOrCtrl+O", "windows")).toBe(true);
  });

  it("rejects the wrong primary modifier for the platform", () => {
    expect(matchesAccelerator(kd("KeyO", { ctrl: true }), "CmdOrCtrl+O", "macos")).toBe(false);
    expect(matchesAccelerator(kd("KeyO", { meta: true }), "CmdOrCtrl+O", "windows")).toBe(false);
  });

  it("requires Shift state to match", () => {
    expect(
      matchesAccelerator(kd("KeyO", { meta: true, shift: true }), "CmdOrCtrl+Shift+O", "macos"),
    ).toBe(true);
    expect(
      matchesAccelerator(kd("KeyO", { meta: true, shift: true }), "CmdOrCtrl+O", "macos"),
    ).toBe(false);
  });

  it("matches symbol bindings", () => {
    expect(matchesAccelerator(kd("Backslash", { ctrl: true }), "CmdOrCtrl+\\", "windows")).toBe(
      true,
    );
    expect(matchesAccelerator(kd("Comma", { meta: true }), "CmdOrCtrl+,", "macos")).toBe(true);
  });

  it("returns false for an unmappable key", () => {
    expect(matchesAccelerator(kd("ShiftLeft", { meta: true }), "CmdOrCtrl+O", "macos")).toBe(false);
  });

  it("returns false for an invalid accelerator string", () => {
    expect(matchesAccelerator(kd("KeyO", { meta: true }), "CmdOrCtrl", "macos")).toBe(false);
  });
});

describe("formatAccelerator", () => {
  it("renders macOS glyphs", () => {
    expect(formatAccelerator("CmdOrCtrl+Shift+O", "macos")).toBe("⌘⇧O");
    expect(formatAccelerator("CmdOrCtrl+,", "macos")).toBe("⌘,");
    expect(formatAccelerator("CmdOrCtrl+Up", "macos")).toBe("⌘↑");
  });

  it("renders a +-joined label elsewhere", () => {
    expect(formatAccelerator("CmdOrCtrl+Shift+O", "windows")).toBe("Ctrl+Shift+O");
    expect(formatAccelerator("CmdOrCtrl+\\", "linux")).toBe("Ctrl+\\");
  });

  it("renders the macOS Option glyph and modifier-less combos", () => {
    expect(formatAccelerator("CmdOrCtrl+Alt+O", "macos")).toBe("⌘⌥O");
    expect(formatAccelerator("Alt+Shift+O", "macos")).toBe("⌥⇧O");
  });

  it("renders Alt and modifier-less combos elsewhere", () => {
    expect(formatAccelerator("Alt+Shift+5", "windows")).toBe("Alt+Shift+5");
  });

  it("returns the raw string for an invalid accelerator", () => {
    expect(formatAccelerator("CmdOrCtrl", "macos")).toBe("CmdOrCtrl");
  });
});

describe("matchesAccelerator without a physical code", () => {
  // Virtual keyboards, remote sessions and synthesized events can deliver an
  // empty `code`; the binding must still match on the produced character.
  const press = (init: KeyboardEventInit) => new KeyboardEvent("keydown", { code: "", ...init });

  it("matches a letter binding from event.key", () => {
    expect(matchesAccelerator(press({ key: "i", ctrlKey: true }), "CmdOrCtrl+I", "windows")).toBe(
      true,
    );
  });

  it("still respects modifiers", () => {
    expect(matchesAccelerator(press({ key: "i" }), "CmdOrCtrl+I", "windows")).toBe(false);
  });

  it("matches a shifted letter binding", () => {
    expect(
      matchesAccelerator(
        press({ key: "B", ctrlKey: true, shiftKey: true }),
        "CmdOrCtrl+Shift+B",
        "windows",
      ),
    ).toBe(true);
  });

  it("does not match a different letter", () => {
    expect(matchesAccelerator(press({ key: "j", ctrlKey: true }), "CmdOrCtrl+I", "windows")).toBe(
      false,
    );
  });
});

describe("tokenFromEvent fallback for named keys", () => {
  it("matches a named key when the code is missing", () => {
    const event = new KeyboardEvent("keydown", { key: "Enter", code: "", ctrlKey: true });
    expect(matchesAccelerator(event, "CmdOrCtrl+Enter", "windows")).toBe(true);
  });

  it("rejects a key it cannot map", () => {
    const event = new KeyboardEvent("keydown", { key: "Unidentified", code: "", ctrlKey: true });
    expect(matchesAccelerator(event, "CmdOrCtrl+Enter", "windows")).toBe(false);
  });
});

describe("tokenFromEvent digit fallback", () => {
  it("matches a digit binding when the code is missing", () => {
    const event = new KeyboardEvent("keydown", { key: "0", code: "", ctrlKey: true });
    expect(matchesAccelerator(event, "CmdOrCtrl+0", "windows")).toBe(true);
  });
});
