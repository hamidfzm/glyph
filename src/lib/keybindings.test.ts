import { describe, expect, it } from "vitest";
import {
  acceleratorFromEvent,
  BINDABLE_COMMANDS,
  findConflicts,
  formatAccelerator,
  getBindableCommand,
  matchesAccelerator,
  parseAccelerator,
  resolveBindings,
} from "./keybindings";

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

describe("acceleratorFromEvent", () => {
  it("builds a canonical string from a letter key", () => {
    expect(acceleratorFromEvent(kd("KeyO", { meta: true }))).toBe("CmdOrCtrl+O");
  });

  it("includes Alt and Shift and maps digits", () => {
    expect(acceleratorFromEvent(kd("Digit5", { ctrl: true, shift: true }))).toBe(
      "CmdOrCtrl+Shift+5",
    );
  });

  it("maps punctuation codes to their tokens", () => {
    expect(acceleratorFromEvent(kd("Backslash", { meta: true }))).toBe("CmdOrCtrl+\\");
    expect(acceleratorFromEvent(kd("Equal", { ctrl: true }))).toBe("CmdOrCtrl+=");
    expect(acceleratorFromEvent(kd("Comma", { alt: true }))).toBe("Alt+,");
  });

  it("returns null when only modifier keys are held", () => {
    expect(acceleratorFromEvent(kd("ShiftLeft", { shift: true }))).toBeNull();
    expect(acceleratorFromEvent(kd("MetaLeft", { meta: true }))).toBeNull();
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
});

describe("resolveBindings", () => {
  it("returns defaults when there are no overrides", () => {
    const resolved = resolveBindings();
    expect(resolved.get("open")).toBe("CmdOrCtrl+O");
    expect(resolved.get("open-command-palette")).toBe("CmdOrCtrl+K");
  });

  it("applies an override and ignores an empty one", () => {
    const resolved = resolveBindings({ open: "CmdOrCtrl+Shift+P", find: "" });
    expect(resolved.get("open")).toBe("CmdOrCtrl+Shift+P");
    expect(resolved.get("find")).toBe("CmdOrCtrl+F");
  });
});

describe("findConflicts", () => {
  it("reports no conflicts for the default bindings", () => {
    expect(findConflicts(resolveBindings()).size).toBe(0);
  });

  it("flags both commands that share an accelerator", () => {
    const conflicts = findConflicts(resolveBindings({ open: "CmdOrCtrl+F" }));
    expect(conflicts.has("open")).toBe(true);
    expect(conflicts.has("find")).toBe(true);
  });
});

describe("BINDABLE_COMMANDS", () => {
  it("has unique ids", () => {
    const ids = BINDABLE_COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is looked up by id", () => {
    expect(getBindableCommand("open")?.label).toBe("Open File");
    expect(getBindableCommand("nope")).toBeUndefined();
  });
});
