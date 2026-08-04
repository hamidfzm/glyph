import { describe, expect, it } from "vitest";
import { findConflicts, resolveBindings } from "./keybindings";

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

  it("skips entries whose accelerator is invalid", () => {
    const conflicts = findConflicts(
      new Map([
        ["a", "CmdOrCtrl+O"],
        ["bad", "CmdOrCtrl"],
        ["b", "CmdOrCtrl+O"],
      ]),
    );
    expect(conflicts).toEqual(new Set(["a", "b"]));
  });

  it("detects conflicts among Alt / modifier-less bindings", () => {
    const conflicts = findConflicts(
      new Map([
        ["x", "Alt+P"],
        ["y", "Alt+P"],
      ]),
    );
    expect(conflicts.has("x")).toBe(true);
    expect(conflicts.has("y")).toBe(true);
  });
});
