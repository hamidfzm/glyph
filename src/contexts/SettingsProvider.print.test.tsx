import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsProvider } from "@/contexts/SettingsProvider";
import { realMatchMedia, resetSettingsDom, TestConsumer } from "@/test/settingsHarness";

// Chromium reports a light scheme for as long as a print is open, then the real
// one again just after afterprint. The system theme must not follow the print.

let changeHandler: ((e: { matches: boolean }) => void) | undefined;

const isDark = () => document.documentElement.classList.contains("dark");
const systemTurns = (dark: boolean) => act(() => changeHandler?.({ matches: dark }));
const printEvent = (type: "beforeprint" | "afterprint") => window.dispatchEvent(new Event(type));

async function renderOnDarkSystem() {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: true,
    addEventListener: (_type: string, handler: (e: { matches: boolean }) => void) => {
      changeHandler = handler;
    },
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;

  const view = render(
    <SettingsProvider>
      <TestConsumer />
    </SettingsProvider>,
  );
  await waitFor(() => {
    expect(screen.getByTestId("loaded").textContent).toBe("true");
  });
  expect(screen.getByTestId("theme").textContent).toBe("system");
  expect(isDark()).toBe(true);
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetSettingsDom();
  changeHandler = undefined;
});

afterEach(() => {
  window.matchMedia = realMatchMedia;
});

describe("SettingsProvider system theme during print", () => {
  it("stays dark while a print reports a light scheme", async () => {
    await renderOnDarkSystem();

    printEvent("beforeprint");
    systemTurns(false);
    expect(isDark()).toBe(true);

    printEvent("afterprint");
    systemTurns(true);
    expect(isDark()).toBe(true);
  });

  it("follows the system theme again once the print closes", async () => {
    await renderOnDarkSystem();

    printEvent("beforeprint");
    printEvent("afterprint");
    systemTurns(false);
    expect(isDark()).toBe(false);

    printEvent("beforeprint");
    systemTurns(true);
    expect(isDark()).toBe(false);
  });

  it("stops listening for prints on unmount", async () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = await renderOnDarkSystem();

    unmount();
    expect(removeSpy).toHaveBeenCalledWith("beforeprint", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("afterprint", expect.any(Function));
    removeSpy.mockRestore();
  });
});
