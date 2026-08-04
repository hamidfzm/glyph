import { describe, expect, it } from "vitest";
import { BINDABLE_COMMANDS, getBindableCommand } from "./bindableCommands";

describe("BINDABLE_COMMANDS", () => {
  it("has unique ids", () => {
    const ids = BINDABLE_COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is looked up by id", () => {
    expect(getBindableCommand("open")?.label).toBe("Open File");
    expect(getBindableCommand("nope")).toBeUndefined();
  });

  it("binds the graph view to CmdOrCtrl+G by default", () => {
    const command = getBindableCommand("open-graph");
    expect(command?.label).toBe("Open Graph");
    expect(command?.defaultAccelerator).toBe("CmdOrCtrl+G");
    expect(command?.event).toBe("menu-open-graph");
    expect(command?.nativeMenu).toBe(true);
  });

  it("includes the in-app undo/redo and Close Window commands", () => {
    expect(getBindableCommand("undo")?.defaultAccelerator).toBe("CmdOrCtrl+Z");
    expect(getBindableCommand("redo")?.defaultAccelerator).toBe("CmdOrCtrl+Shift+Z");
    expect(getBindableCommand("close")?.defaultAccelerator).toBe("CmdOrCtrl+Shift+W");
    // undo/redo are in-app only, not native-menu commands.
    expect(getBindableCommand("undo")?.nativeMenu).toBe(false);
    expect(getBindableCommand("close")?.nativeMenu).toBe(true);
  });
});
