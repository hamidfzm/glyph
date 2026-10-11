import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deferred } from "@/test/deferred";
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

function mockSettings(prompt: string, loaded = true, updateSettings = vi.fn()) {
  useSettingsMock.mockReturnValue({
    settings: { behavior: { defaultAppPrompt: prompt } },
    updateSettings,
    loaded,
  });
  return updateSettings;
}

function setup(prompt: string, loaded = true, primary = true) {
  const updateSettings = mockSettings(prompt, loaded);
  isPrimaryWindowMock.mockReturnValue(primary);
  const { result, rerender } = renderHook(() => useDefaultAppPrompt());
  return { result, rerender, updateSettings };
}

describe("useDefaultAppPrompt", () => {
  beforeEach(() => {
    setDefaultMock.mockClear();
  });

  it("shows only when unanswered, loaded, and in the primary window", () => {
    expect(setup("unanswered").result.current.show).toBe(true);
    expect(setup("set").result.current.show).toBe(false);
    expect(setup("guided").result.current.show).toBe(false);
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

  it.each(["registered", "openedSettings"])(
    "stores 'set' once the platform reports %s",
    async (tag) => {
      setDefaultMock.mockResolvedValueOnce(tag);
      const { result, updateSettings } = setup("unanswered");

      await act(async () => {
        await result.current.setDefault();
      });

      expect(updateSettings).toHaveBeenCalledWith("behavior.defaultAppPrompt", "set");
      expect(result.current.outcome).toBeNull();
    },
  );

  it("is busy and stores nothing while the command runs", async () => {
    const command = deferred<string>();
    setDefaultMock.mockReturnValueOnce(command.promise);
    const { result, updateSettings } = setup("unanswered");

    let done = Promise.resolve();
    act(() => {
      done = result.current.setDefault();
    });
    expect(result.current.busy).toBe(true);
    expect(updateSettings).not.toHaveBeenCalled();

    await act(async () => {
      command.resolve("registered");
      await done;
    });
    expect(result.current.busy).toBe(false);
  });

  it.each(["guidance", "sandboxed", "noDesktopEntry"])(
    "holds %s until it is dismissed, then stores 'guided'",
    async (tag) => {
      setDefaultMock.mockResolvedValueOnce(tag);
      const { result, updateSettings } = setup("unanswered");

      await act(async () => {
        await result.current.setDefault();
      });
      expect(result.current.outcome).toBe(tag);
      expect(result.current.show).toBe(true);
      expect(updateSettings).not.toHaveBeenCalled();

      act(() => result.current.dismissOutcome());
      expect(updateSettings).toHaveBeenCalledWith("behavior.defaultAppPrompt", "guided");
      expect(updateSettings).toHaveBeenCalledTimes(1);
      expect(result.current.outcome).toBeNull();
    },
  );

  it("leaves a failure unanswered and hides it for the session", async () => {
    setDefaultMock.mockResolvedValueOnce("error");
    const { result, updateSettings } = setup("unanswered");

    await act(async () => {
      await result.current.setDefault();
    });
    expect(result.current.outcome).toBe("error");
    expect(result.current.show).toBe(true);

    act(() => result.current.dismissOutcome());
    expect(result.current.show).toBe(false);
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it.each(["registered", "guidance"])(
    "drops a %s result that lands after 'Never' was chosen",
    async (tag) => {
      const command = deferred<string>();
      setDefaultMock.mockReturnValueOnce(command.promise);
      const { result, rerender, updateSettings } = setup("unanswered");

      let done = Promise.resolve();
      act(() => {
        done = result.current.setDefault();
      });
      mockSettings("never", true, updateSettings);
      rerender();

      await act(async () => {
        command.resolve(tag);
        await done;
      });
      expect(updateSettings).not.toHaveBeenCalled();
      expect(result.current.outcome).toBeNull();
      expect(result.current.busy).toBe(false);
    },
  );

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
