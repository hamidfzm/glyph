import { describe, expect, it, vi } from "vitest";
import {
  isCommandAvailable,
  isMenuCommand,
  paletteShortcut,
  pluginBindableCommands,
  pluginBindingId,
} from "./commandBindings";
import type { CommandEntry } from "./types";

function command(over: Partial<CommandEntry> = {}): CommandEntry {
  return {
    pluginId: "com.x.notes",
    id: "today",
    title: "Open Today's Note",
    run: vi.fn(),
    ...over,
  };
}

describe("pluginBindingId", () => {
  it("names the command by plugin and id, apart from the built-in ids", () => {
    expect(pluginBindingId(command())).toBe("plugin:com.x.notes/today");
  });
});

describe("pluginBindableCommands", () => {
  it("lists a command with a default shortcut as a Plugins row", () => {
    const rows = pluginBindableCommands([command({ shortcut: "CmdOrCtrl+Shift+T" })]);
    expect(rows).toEqual([
      {
        id: "plugin:com.x.notes/today",
        label: "Open Today's Note",
        category: "Plugins",
        defaultAccelerator: "CmdOrCtrl+Shift+T",
        nativeMenu: false,
      },
    ]);
  });

  it("marks a command that is also in a native menu", () => {
    const [row] = pluginBindableCommands([command({ shortcut: "CmdOrCtrl+J", menu: "file" })]);
    expect(row.nativeMenu).toBe(true);
  });

  it("leaves out a command without a shortcut", () => {
    expect(pluginBindableCommands([command()])).toEqual([]);
  });

  // The value is plugin data, and from a sandboxed plugin it is worker data.
  it("leaves out a shortcut that is not a parseable accelerator", () => {
    const malformed = [
      command({ shortcut: "CmdOrCtrl+A+B" }),
      command({ shortcut: "" }),
      command({ shortcut: 7 as never }),
      command({ shortcut: { toString: () => "CmdOrCtrl+T" } as never }),
    ];
    expect(pluginBindableCommands(malformed)).toEqual([]);
  });

  // A shortcut without Cmd/Ctrl or Alt would run the command on ordinary typing.
  it("leaves out a shortcut that is a bare key, or holds Shift alone", () => {
    const typing = ["A", "Space", "Enter", "F5", "Shift+A"].map((shortcut) =>
      command({ shortcut }),
    );
    expect(pluginBindableCommands(typing)).toEqual([]);
  });

  it("leaves out a shortcut every text field needs", () => {
    const editing = ["CmdOrCtrl+A", "Ctrl+C", "Cmd+V", "CmdOrCtrl+x", "CmdOrCtrl+Y"].map(
      (shortcut) => command({ shortcut }),
    );
    expect(pluginBindableCommands(editing)).toEqual([]);
    expect(pluginBindableCommands([command({ shortcut: "CmdOrCtrl+Z" })])).toEqual([]);
    expect(pluginBindableCommands([command({ shortcut: "Shift+CmdOrCtrl+Z" })])).toEqual([]);
  });

  it("takes the same keys with another modifier", () => {
    const rows = pluginBindableCommands([
      command({ id: "a", shortcut: "CmdOrCtrl+Shift+V" }),
      command({ id: "b", shortcut: "Alt+C" }),
      command({ id: "c", shortcut: "CmdOrCtrl+Alt+Z" }),
    ]);
    expect(rows.map((row) => row.defaultAccelerator)).toEqual([
      "CmdOrCtrl+Shift+V",
      "Alt+C",
      "CmdOrCtrl+Alt+Z",
    ]);
  });

  // The native menu reads "Ctrl" as Control on macOS; the app reads it as Cmd.
  it("respells a shortcut canonically, so the app and the menu read it alike", () => {
    const [row] = pluginBindableCommands([command({ shortcut: "Shift+Ctrl+t" })]);
    expect(row.defaultAccelerator).toBe("CmdOrCtrl+Shift+T");
  });
});

describe("isMenuCommand", () => {
  it("accepts only the menus the host lists commands in", () => {
    expect(isMenuCommand(command({ menu: "file" }))).toBe(true);
    expect(isMenuCommand(command({ menu: "view" }))).toBe(true);
    expect(isMenuCommand(command())).toBe(false);
    expect(isMenuCommand(command({ menu: "help" as never }))).toBe(false);
  });
});

describe("isCommandAvailable", () => {
  it("offers a workspace command only while a workspace is open", () => {
    const inWorkspace = command({ when: "workspace" });
    expect(isCommandAvailable(inWorkspace, true)).toBe(true);
    expect(isCommandAvailable(inWorkspace, false)).toBe(false);
  });

  it("always offers a command without a condition", () => {
    expect(isCommandAvailable(command(), false)).toBe(true);
  });
});

describe("paletteShortcut", () => {
  it("spells the default shortcut the way the palette does", () => {
    expect(paletteShortcut(command({ shortcut: "CmdOrCtrl+Shift+T" }))).toBe("Cmd/Ctrl+Shift+T");
    expect(paletteShortcut(command({ shortcut: "Alt+J" }))).toBe("Alt+J");
    expect(paletteShortcut(command({ shortcut: "Shift+Cmd+t" }))).toBe("Cmd/Ctrl+Shift+T");
  });

  it("is absent without a usable shortcut", () => {
    expect(paletteShortcut(command())).toBeUndefined();
    expect(paletteShortcut(command({ shortcut: "A+B" }))).toBeUndefined();
    expect(paletteShortcut(command({ shortcut: "T" }))).toBeUndefined();
  });
});
