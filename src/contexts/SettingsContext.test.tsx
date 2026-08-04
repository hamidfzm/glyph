import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { FlushConsumer, resetSettingsDom, TestConsumer } from "@/test/settingsHarness";

beforeEach(resetSettingsDom);

describe("SettingsContext", () => {
  it("has default context value", () => {
    const ctx = {
      settings: DEFAULT_SETTINGS,
      updateSettings: () => {},
      resetSettings: () => {},
      loaded: false,
    };
    expect(ctx.settings).toEqual(DEFAULT_SETTINGS);
    expect(ctx.loaded).toBe(false);
  });

  it("exposes no-op handlers and defaults without a provider", () => {
    render(<TestConsumer />);
    expect(screen.getByTestId("loaded").textContent).toBe("false");
    expect(screen.getByTestId("theme").textContent).toBe("system");
    // The default updateSettings / resetSettings are inert no-ops.
    act(() => screen.getByTestId("change-font").click());
    act(() => screen.getByTestId("reset").click());
    expect(screen.getByTestId("font-size").textContent).toBe("16");
  });

  it("the default flushSettings resolves true without a provider", async () => {
    render(<FlushConsumer />);
    await act(async () => {
      screen.getByTestId("flush").click();
      await Promise.resolve();
    });
    expect(screen.getByTestId("flush-result").textContent).toBe("true");
  });
});
