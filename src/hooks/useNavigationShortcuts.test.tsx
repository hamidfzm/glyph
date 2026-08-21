import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { SettingsContext } from "@/contexts/SettingsContext";
import type { Platform } from "@/hooks/usePlatform";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { TabsWrapper, tabsContextValue } from "@/test/fixtures/tabsContext";
import { useNavigationShortcuts } from "./useNavigationShortcuts";

function setup(platform: Platform, overrides: Record<string, string> = {}) {
  const navigateBack = vi.fn();
  const navigateForward = vi.fn();
  const tabs = tabsContextValue({ navigateBack, navigateForward });
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
      <TabsWrapper value={tabs}>{children}</TabsWrapper>
    </SettingsContext.Provider>
  );
  const hook = renderHook(() => useNavigationShortcuts({ platform }), { wrapper });
  return { navigateBack, navigateForward, unmount: hook.unmount };
}

function keydown(init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true });
  document.dispatchEvent(event);
  return event;
}

function mousedown(button: number) {
  const event = new MouseEvent("mousedown", { button, bubbles: true, cancelable: true });
  document.dispatchEvent(event);
  return event;
}

describe("useNavigationShortcuts", () => {
  it("goes back on Cmd+Alt+Left and forward on Cmd+Alt+Right on macOS", () => {
    const h = setup("macos");
    const back = keydown({ code: "ArrowLeft", key: "ArrowLeft", metaKey: true, altKey: true });
    const forward = keydown({ code: "ArrowRight", key: "ArrowRight", metaKey: true, altKey: true });
    expect(h.navigateBack).toHaveBeenCalledOnce();
    expect(h.navigateForward).toHaveBeenCalledOnce();
    expect(back.defaultPrevented).toBe(true);
    expect(forward.defaultPrevented).toBe(true);
  });

  it("uses Ctrl as the primary modifier on Windows", () => {
    const h = setup("windows");
    keydown({ code: "ArrowLeft", key: "ArrowLeft", ctrlKey: true, altKey: true });
    expect(h.navigateBack).toHaveBeenCalledOnce();
  });

  it("requires the platform's primary modifier and the Alt key", () => {
    const h = setup("macos");
    keydown({ code: "ArrowLeft", key: "ArrowLeft", ctrlKey: true, altKey: true });
    const plain = keydown({ code: "ArrowLeft", key: "ArrowLeft", metaKey: true });
    expect(h.navigateBack).not.toHaveBeenCalled();
    expect(plain.defaultPrevented).toBe(false);
  });

  it("follows a remapped binding", () => {
    const h = setup("macos", { "navigate-back": "CmdOrCtrl+Shift+B" });
    keydown({ code: "ArrowLeft", key: "ArrowLeft", metaKey: true, altKey: true });
    expect(h.navigateBack).not.toHaveBeenCalled();
    keydown({ code: "KeyB", key: "B", metaKey: true, shiftKey: true });
    expect(h.navigateBack).toHaveBeenCalledOnce();
  });

  it("maps the mouse side buttons to back and forward, swallowing the webview's own navigation", () => {
    const h = setup("windows");
    const back = mousedown(3);
    const forward = mousedown(4);
    const primary = mousedown(0);
    expect(h.navigateBack).toHaveBeenCalledOnce();
    expect(h.navigateForward).toHaveBeenCalledOnce();
    expect(back.defaultPrevented).toBe(true);
    expect(forward.defaultPrevented).toBe(true);
    expect(primary.defaultPrevented).toBe(false);
  });

  it("leaves side-button clicks inside a dialog to the dialog", () => {
    const h = setup("windows");
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.appendChild(dialog);
    const event = new MouseEvent("mousedown", { button: 3, bubbles: true, cancelable: true });
    dialog.dispatchEvent(event);
    dialog.remove();
    expect(h.navigateBack).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("stops listening after unmount", () => {
    const h = setup("macos");
    h.unmount();
    keydown({ code: "ArrowLeft", key: "ArrowLeft", metaKey: true, altKey: true });
    mousedown(3);
    expect(h.navigateBack).not.toHaveBeenCalled();
  });
});
