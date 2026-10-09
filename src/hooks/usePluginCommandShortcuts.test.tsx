import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsContext, type SettingsContextValue } from "@/contexts/SettingsContext";
import { TabsContext, type TabsContextValue } from "@/contexts/TabsContext";
import type { Platform } from "@/hooks/usePlatform";
import { createRegistry } from "@/lib/plugins/registry";
import type { CommandEntry } from "@/lib/plugins/types";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { usePluginCommandShortcuts } from "./usePluginCommandShortcuts";

const plugins = vi.hoisted(() => ({ current: null as { commands: unknown } | null }));
vi.mock("@/contexts/PluginsContext", () => ({ usePluginsOptional: () => plugins.current }));

function command(over: Partial<CommandEntry> = {}): CommandEntry {
  return {
    pluginId: "com.x.notes",
    id: "today",
    title: "Open Today's Note",
    shortcut: "CmdOrCtrl+Shift+T",
    run: vi.fn(),
    ...over,
  };
}

interface SetupOptions {
  platform?: Platform;
  overrides?: Record<string, string>;
  workspaceRoot?: string;
}

function setup(commands: CommandEntry[], options: SetupOptions = {}) {
  const registry = createRegistry<CommandEntry>();
  const disposers = commands.map((entry) => registry.register(entry));
  plugins.current = { commands: registry };
  const settings: SettingsContextValue = {
    settings: { ...DEFAULT_SETTINGS, keybindings: { overrides: options.overrides ?? {} } },
    updateSettings: vi.fn(),
    resetSettings: vi.fn(),
    flushSettings: async () => true,
    loaded: true,
  };
  const tabs = {
    workspace: options.workspaceRoot ? { root: options.workspaceRoot } : null,
  } as unknown as TabsContextValue;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SettingsContext.Provider value={settings}>
      <TabsContext.Provider value={tabs}>{children}</TabsContext.Provider>
    </SettingsContext.Provider>
  );
  renderHook(() => usePluginCommandShortcuts(options.platform ?? "windows"), { wrapper });
  return { disposers };
}

function press(init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true });
  document.dispatchEvent(event);
  return event;
}

const CTRL_SHIFT_T = { code: "KeyT", key: "t", ctrlKey: true, shiftKey: true };

beforeEach(() => {
  plugins.current = null;
});

describe("usePluginCommandShortcuts", () => {
  it("runs a plugin command from its default shortcut", () => {
    const today = command();
    setup([today]);

    const event = press(CTRL_SHIFT_T);

    expect(today.run).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves every other key alone", () => {
    const today = command();
    setup([today]);

    const event = press({ code: "KeyT", key: "t", ctrlKey: true });

    expect(today.run).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("follows the user's rebinding instead of the default", () => {
    const today = command();
    setup([today], { overrides: { "plugin:com.x.notes/today": "CmdOrCtrl+Alt+D" } });

    press(CTRL_SHIFT_T);
    expect(today.run).not.toHaveBeenCalled();

    press({ code: "KeyD", key: "d", ctrlKey: true, altKey: true });
    expect(today.run).toHaveBeenCalledOnce();
  });

  // Native menu accelerators never fire on Windows, so a menu command needs the
  // in-app listener there; on macOS and Linux the menu runs it, and handling it
  // here too would run it twice.
  it.each([
    ["windows", { ctrlKey: true }, 1],
    ["macos", { metaKey: true }, 0],
    ["linux", { ctrlKey: true }, 0],
  ] as const)("on %s runs a menu command %i time(s) itself", (platform, modifier, times) => {
    const today = command({ menu: "file" });
    setup([today], { platform });

    press({ code: "KeyT", key: "t", shiftKey: true, ...modifier });

    expect(today.run).toHaveBeenCalledTimes(times);
  });

  it("runs a command that is in no menu on every platform", () => {
    const today = command();
    setup([today], { platform: "macos" });

    press({ code: "KeyT", key: "t", shiftKey: true, metaKey: true });

    expect(today.run).toHaveBeenCalledOnce();
  });

  it("keeps a workspace command quiet while no workspace is open", () => {
    const today = command({ when: "workspace" });
    setup([today]);

    const event = press(CTRL_SHIFT_T);

    expect(today.run).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("runs a workspace command once a workspace is open", () => {
    const today = command({ when: "workspace" });
    setup([today], { workspaceRoot: "/ws" });

    press(CTRL_SHIFT_T);

    expect(today.run).toHaveBeenCalledOnce();
  });

  it("binds nothing for a shortcut it cannot parse", () => {
    const broken = command({ shortcut: "CmdOrCtrl+Shift+T+U" });
    setup([broken]);

    press(CTRL_SHIFT_T);

    expect(broken.run).not.toHaveBeenCalled();
  });

  it("stops running a command once its plugin unloads", () => {
    const today = command();
    const { disposers } = setup([today]);

    act(() => disposers[0]());
    press(CTRL_SHIFT_T);

    expect(today.run).not.toHaveBeenCalled();
  });

  it("does nothing without a plugins provider", () => {
    renderHook(() => usePluginCommandShortcuts("windows"));
    expect(press(CTRL_SHIFT_T).defaultPrevented).toBe(false);
  });
});
