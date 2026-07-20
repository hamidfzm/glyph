import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDefaultAppPrompt } from "./useDefaultAppPrompt";

const { useSettingsMock } = vi.hoisted(() => ({ useSettingsMock: vi.fn() }));
vi.mock("@/hooks/useSettings", () => ({ useSettings: useSettingsMock }));

const { isPrimaryWindowMock } = vi.hoisted(() => ({ isPrimaryWindowMock: vi.fn() }));
vi.mock("@/lib/windowContext", () => ({ isPrimaryWindow: isPrimaryWindowMock }));

const { setDefaultMock } = vi.hoisted(() => ({
  setDefaultMock: vi.fn(() => Promise.resolve("openedSettings")),
}));
vi.mock("@/lib/defaultApp", () => ({ setDefaultMarkdownApp: setDefaultMock }));

vi.mock("@tauri-apps/plugin-os", () => ({ platform: vi.fn(() => "macos") }));

function setup(prompt: string, loaded = true, primary = true) {
  const updateSettings = vi.fn();
  useSettingsMock.mockReturnValue({
    settings: { behavior: { defaultAppPrompt: prompt } },
    updateSettings,
    loaded,
  });
  isPrimaryWindowMock.mockReturnValue(primary);
  const { result } = renderHook(() => useDefaultAppPrompt());
  return { result, updateSettings };
}

describe("useDefaultAppPrompt", () => {
  beforeEach(() => {
    setDefaultMock.mockClear();
  });

  it("shows only when unanswered, loaded, and in the primary window", () => {
    expect(setup("unanswered").result.current.show).toBe(true);
    expect(setup("set").result.current.show).toBe(false);
    expect(setup("notNow").result.current.show).toBe(false);
    expect(setup("never").result.current.show).toBe(false);
    expect(setup("unanswered", false).result.current.show).toBe(false);
    expect(setup("unanswered", true, false).result.current.show).toBe(false);
  });

  it("never shows on mobile (default-app registration is desktop-only)", async () => {
    const { platform } = await import("@tauri-apps/plugin-os");
    vi.mocked(platform).mockReturnValue("ios");
    expect(setup("unanswered").result.current.show).toBe(false);
    vi.mocked(platform).mockReturnValue("macos");
  });

  it("records the answer and triggers registration on 'set default'", () => {
    const { result, updateSettings } = setup("unanswered");
    act(() => result.current.setDefault());
    expect(updateSettings).toHaveBeenCalledWith("behavior.defaultAppPrompt", "set");
    expect(setDefaultMock).toHaveBeenCalledTimes(1);
  });

  it("records 'not now' and 'never' without registering", () => {
    const notNow = setup("unanswered");
    act(() => notNow.result.current.notNow());
    expect(notNow.updateSettings).toHaveBeenCalledWith("behavior.defaultAppPrompt", "notNow");

    const never = setup("unanswered");
    act(() => never.result.current.never());
    expect(never.updateSettings).toHaveBeenCalledWith("behavior.defaultAppPrompt", "never");

    expect(setDefaultMock).not.toHaveBeenCalled();
  });
});
