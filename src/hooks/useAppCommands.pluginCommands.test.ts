import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MenuEventHandlers } from "@/hooks/useMenuEvents";
import { createRegistry } from "@/lib/plugins/registry";
import type { CommandEntry } from "@/lib/plugins/types";
import { type AppActions, useAppCommands } from "./useAppCommands";

const plugins = vi.hoisted(() => ({ current: null as { commands: unknown } | null }));
vi.mock("@/contexts/PluginsContext", () => ({ usePluginsOptional: () => plugins.current }));

// The palette never calls an action while it only builds the list.
const actions = {} as MenuEventHandlers as AppActions;

function paletteWith(command: CommandEntry, workspaceOpen: boolean) {
  const commands = createRegistry<CommandEntry>();
  commands.register(command);
  plugins.current = { commands };
  const { result } = renderHook(() =>
    useAppCommands({ workspaceOpen, workspaceFiles: [], tocEntries: [], actions }),
  );
  return result.current.find((entry) => entry.id === "plugin:com.x.notes/today");
}

function command(over: Partial<CommandEntry> = {}): CommandEntry {
  return {
    pluginId: "com.x.notes",
    id: "today",
    title: "Open Today's Note",
    run: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  plugins.current = null;
});

describe("useAppCommands plugin command presence", () => {
  it("shows a plugin command's default shortcut", () => {
    const entry = paletteWith(command({ shortcut: "CmdOrCtrl+Shift+T" }), false);
    expect(entry?.shortcut).toBe("Cmd/Ctrl+Shift+T");
  });

  it("shows no shortcut for a command that declares none", () => {
    expect(paletteWith(command(), false)?.shortcut).toBeUndefined();
  });

  it("offers a workspace command only while a workspace is open", () => {
    const today = command({ when: "workspace" });
    expect(paletteWith(today, false)).toBeUndefined();
    expect(paletteWith(today, true)?.title).toBe("Open Today's Note");
  });
});
