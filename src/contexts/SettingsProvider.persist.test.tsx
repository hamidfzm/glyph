import type { getStore } from "@tauri-apps/plugin-store";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsProvider } from "@/contexts/SettingsProvider";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { expectConsole } from "@/test/consoleGuard";
import {
  FlushConsumer,
  mockedGetStore,
  mockStore,
  resetSettingsDom,
  TestConsumer,
  UpdateConsumer,
} from "@/test/settingsHarness";

beforeEach(() => {
  vi.clearAllMocks();
  resetSettingsDom();
});

describe("SettingsProvider persistence", () => {
  describe("persisting changes", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("debounces writes to the store", async () => {
      const { set } = mockStore(null);

      render(
        <SettingsProvider>
          <UpdateConsumer updates={[["appearance.fontSize", 19]]} />
        </SettingsProvider>,
      );
      await waitFor(() => {
        expect(screen.getByTestId("loaded").textContent).toBe("true");
      });

      vi.useFakeTimers();
      act(() => screen.getByTestId("update-0").click());
      expect(set).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(500);
        await Promise.resolve();
      });

      expect(set).toHaveBeenCalledWith(
        "settings",
        expect.objectContaining({
          appearance: expect.objectContaining({ fontSize: 19 }),
        }),
      );
    });

    it("logs and swallows store write errors", async () => {
      // The unmount-time flush retries the still-rejecting store after the
      // spy below is restored, so that late log is declared to the guard.
      expectConsole(/Failed to save settings/);
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockStore(null, { setRejects: true });

      render(
        <SettingsProvider>
          <UpdateConsumer updates={[["appearance.fontSize", 18]]} />
        </SettingsProvider>,
      );
      await waitFor(() => {
        expect(screen.getByTestId("loaded").textContent).toBe("true");
      });

      vi.useFakeTimers();
      act(() => screen.getByTestId("update-0").click());
      await act(async () => {
        vi.advanceTimersByTime(500);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(errSpy).toHaveBeenCalledWith("Failed to save settings:", expect.any(Error));
      errSpy.mockRestore();
    });

    it("persists a reset to the store", async () => {
      const { set } = mockStore(null);

      render(
        <SettingsProvider>
          <TestConsumer />
        </SettingsProvider>,
      );
      await waitFor(() => {
        expect(screen.getByTestId("loaded").textContent).toBe("true");
      });

      vi.useFakeTimers();
      act(() => screen.getByTestId("reset").click());
      await act(async () => {
        vi.advanceTimersByTime(500);
        await Promise.resolve();
      });

      expect(set).toHaveBeenCalledWith("settings", DEFAULT_SETTINGS);
    });
  });

  describe("flushSettings", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    async function renderFlushConsumer() {
      const view = render(
        <SettingsProvider>
          <FlushConsumer />
        </SettingsProvider>,
      );
      await waitFor(() => {
        expect(screen.getByTestId("loaded").textContent).toBe("true");
      });
      return view;
    }

    it("persists an update still inside the debounce window", async () => {
      const { set, save } = mockStore(null);
      await renderFlushConsumer();

      vi.useFakeTimers();
      act(() => screen.getByTestId("update-font").click());
      expect(set).not.toHaveBeenCalled();

      await act(async () => {
        screen.getByTestId("flush").click();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(set).toHaveBeenCalledTimes(1);
      expect(set).toHaveBeenCalledWith(
        "settings",
        expect.objectContaining({
          appearance: expect.objectContaining({ fontSize: 21 }),
        }),
      );
      expect(save).toHaveBeenCalled();
      expect(screen.getByTestId("flush-result").textContent).toBe("true");

      // The debounce timer was cleared, so nothing writes a second time.
      await act(async () => {
        vi.advanceTimersByTime(500);
        await Promise.resolve();
      });
      expect(set).toHaveBeenCalledTimes(1);
    });

    it("coalesces rapid updates into one write of the latest value", async () => {
      const { set } = mockStore(null);
      await renderFlushConsumer();

      vi.useFakeTimers();
      act(() => screen.getByTestId("update-font").click());
      act(() => screen.getByTestId("update-font-again").click());

      await act(async () => {
        screen.getByTestId("flush").click();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(set).toHaveBeenCalledTimes(1);
      expect(set).toHaveBeenCalledWith(
        "settings",
        expect.objectContaining({
          appearance: expect.objectContaining({ fontSize: 22 }),
        }),
      );
    });

    it("reports a failed write", async () => {
      // The unmount-time flush retries the still-rejecting store after the
      // spy below is restored, so that late log is declared to the guard.
      expectConsole(/Failed to save settings/);
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockStore(null, { setRejects: true });
      await renderFlushConsumer();

      vi.useFakeTimers();
      act(() => screen.getByTestId("update-font").click());

      await act(async () => {
        screen.getByTestId("flush").click();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.getByTestId("flush-result").textContent).toBe("false");
      expect(errSpy).toHaveBeenCalledWith("Failed to save settings:", expect.any(Error));
      errSpy.mockRestore();
    });

    it("is a no-op without a pending update", async () => {
      const { set, save } = mockStore(null);
      await renderFlushConsumer();

      await act(async () => {
        screen.getByTestId("flush").click();
        await Promise.resolve();
      });

      expect(screen.getByTestId("flush-result").textContent).toBe("true");
      expect(set).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
    });

    it("keeps a newer update pending when it lands during an in-flight write", async () => {
      let resolveSet: (() => void) | null = null;
      const set = vi.fn(
        () =>
          new Promise<void>((r) => {
            resolveSet = r;
          }),
      );
      const save = vi.fn(() => Promise.resolve());
      const get = vi.fn(() => Promise.resolve(null));
      mockedGetStore.mockResolvedValueOnce({ get, set, save } as unknown as Awaited<
        ReturnType<typeof getStore>
      >);
      await renderFlushConsumer();

      vi.useFakeTimers();
      act(() => screen.getByTestId("update-font").click());
      act(() => screen.getByTestId("flush").click());
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(set).toHaveBeenCalledTimes(1);

      // The write for fontSize 21 is still awaiting; a newer update arrives.
      act(() => screen.getByTestId("update-font-again").click());
      await act(async () => {
        resolveSet?.();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      // The newer value stayed pending, so the next flush writes it.
      await act(async () => {
        screen.getByTestId("flush").click();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(set).toHaveBeenCalledTimes(2);
      expect(set).toHaveBeenLastCalledWith(
        "settings",
        expect.objectContaining({
          appearance: expect.objectContaining({ fontSize: 22 }),
        }),
      );
    });

    it("writes a pending update on unmount instead of abandoning it", async () => {
      const { set } = mockStore(null);
      const { unmount } = await renderFlushConsumer();

      vi.useFakeTimers();
      act(() => screen.getByTestId("update-font").click());
      expect(set).not.toHaveBeenCalled();

      await act(async () => {
        unmount();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(set).toHaveBeenCalledWith(
        "settings",
        expect.objectContaining({
          appearance: expect.objectContaining({ fontSize: 21 }),
        }),
      );
    });
  });
});
