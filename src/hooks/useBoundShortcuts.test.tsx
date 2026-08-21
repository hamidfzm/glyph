import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { SettingsContext } from "@/contexts/SettingsContext";
import type { Platform } from "@/hooks/usePlatform";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { useBoundShortcuts } from "./useBoundShortcuts";

function setup(platform: Platform, overrides: Record<string, string> = {}) {
  const onGraph = vi.fn();
  const onEdit = vi.fn();
  const settings = { ...DEFAULT_SETTINGS, keybindings: { overrides } };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SettingsContext.Provider
      value={{
        settings,
        updateSettings: () => {},
        resetSettings: () => {},
        flushSettings: async () => true,
        loaded: true,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
  const hook = renderHook(
    () => useBoundShortcuts(platform, { "open-graph": onGraph, "toggle-edit": onEdit }),
    { wrapper },
  );
  return { onGraph, onEdit, unmount: hook.unmount };
}

function keydown(init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true });
  document.dispatchEvent(event);
  return event;
}

describe("useBoundShortcuts", () => {
  it("runs the handler whose binding matches and consumes the key", () => {
    const h = setup("macos");
    const event = keydown({ code: "KeyG", key: "g", metaKey: true });
    expect(h.onGraph).toHaveBeenCalledOnce();
    expect(h.onEdit).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves unrelated keys alone", () => {
    const h = setup("windows");
    const event = keydown({ code: "KeyG", key: "g" });
    expect(h.onGraph).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("follows a remapped binding", () => {
    const h = setup("windows", { "toggle-edit": "CmdOrCtrl+Shift+E" });
    keydown({ code: "KeyE", key: "e", ctrlKey: true });
    expect(h.onEdit).not.toHaveBeenCalled();
    keydown({ code: "KeyE", key: "E", ctrlKey: true, shiftKey: true });
    expect(h.onEdit).toHaveBeenCalledOnce();
  });

  it("ignores ids that have no binding", () => {
    const onNothing = vi.fn();
    renderHook(() => useBoundShortcuts("macos", { "not-a-command": onNothing }));
    keydown({ code: "KeyG", key: "g", metaKey: true });
    expect(onNothing).not.toHaveBeenCalled();
  });

  it("stops listening after unmount", () => {
    const h = setup("macos");
    h.unmount();
    keydown({ code: "KeyG", key: "g", metaKey: true });
    expect(h.onGraph).not.toHaveBeenCalled();
  });
});
