import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useErrorReportingPrompt } from "./useErrorReportingPrompt";

const { useSettingsMock } = vi.hoisted(() => ({ useSettingsMock: vi.fn() }));
vi.mock("@/hooks/useSettings", () => ({ useSettings: useSettingsMock }));

const { isPrimaryWindowMock } = vi.hoisted(() => ({ isPrimaryWindowMock: vi.fn() }));
vi.mock("@/lib/windowContext", () => ({ isPrimaryWindow: isPrimaryWindowMock }));

interface Options {
  prompt?: string;
  errorReporting?: boolean;
  defaultAppPrompt?: string;
  loaded?: boolean;
  primary?: boolean;
}

function setup({
  prompt = "unanswered",
  errorReporting = false,
  defaultAppPrompt = "never",
  loaded = true,
  primary = true,
}: Options = {}) {
  const updateSettings = vi.fn();
  useSettingsMock.mockReturnValue({
    settings: {
      privacy: { errorReporting, errorReportingPrompt: prompt },
      behavior: { defaultAppPrompt },
    },
    updateSettings,
    loaded,
  });
  isPrimaryWindowMock.mockReturnValue(primary);
  const { result } = renderHook(() => useErrorReportingPrompt());
  return { result, updateSettings };
}

describe("useErrorReportingPrompt", () => {
  it("shows only when unanswered, loaded, and in the primary window", () => {
    expect(setup().result.current.show).toBe(true);
    expect(setup({ prompt: "enabled" }).result.current.show).toBe(false);
    expect(setup({ prompt: "declined" }).result.current.show).toBe(false);
    expect(setup({ loaded: false }).result.current.show).toBe(false);
    expect(setup({ primary: false }).result.current.show).toBe(false);
  });

  it("never shows when reporting is already on", () => {
    expect(setup({ errorReporting: true }).result.current.show).toBe(false);
  });

  it("waits for the default-app prompt so banners appear one at a time", () => {
    expect(setup({ defaultAppPrompt: "unanswered" }).result.current.show).toBe(false);
    expect(setup({ defaultAppPrompt: "set" }).result.current.show).toBe(true);
  });

  it("enables reporting and records the answer", () => {
    const { result, updateSettings } = setup();
    act(() => result.current.enable());
    expect(updateSettings).toHaveBeenCalledWith("privacy.errorReporting", true);
    expect(updateSettings).toHaveBeenCalledWith("privacy.errorReportingPrompt", "enabled");
  });

  it("records a decline without enabling reporting", () => {
    const { result, updateSettings } = setup();
    act(() => result.current.decline());
    expect(updateSettings).toHaveBeenCalledExactlyOnceWith(
      "privacy.errorReportingPrompt",
      "declined",
    );
  });
});
