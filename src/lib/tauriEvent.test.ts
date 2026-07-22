import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { afterEach, describe, expect, it, vi } from "vitest";
import { subscribe } from "@/lib/tauriEvent";

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: vi.fn(() => ({ label: "w1" })),
}));

describe("subscribe", () => {
  afterEach(() => {
    vi.mocked(listen).mockReset();
    vi.mocked(listen).mockImplementation(() => Promise.resolve(vi.fn()));
  });

  it("registers a listener scoped to the current window", () => {
    // Regression: an unscoped listen() has target Any and also receives events
    // emit_to'd at other windows, so one window's menu action fired in all.
    const handler = vi.fn();
    subscribe("file-changed", handler);
    expect(listen).toHaveBeenCalledWith("file-changed", handler, {
      target: { kind: "WebviewWindow", label: "w1" },
    });
  });

  it("falls back to an unscoped listener outside Tauri", () => {
    vi.mocked(getCurrentWebviewWindow).mockImplementationOnce(() => {
      throw new Error("no Tauri internals");
    });
    const handler = vi.fn();
    subscribe("file-changed", handler);
    expect(listen).toHaveBeenCalledWith("file-changed", handler, undefined);
  });

  it("calls the underlying unlisten when the teardown runs", async () => {
    const unlisten = vi.fn();
    vi.mocked(listen).mockResolvedValue(unlisten);

    const teardown = subscribe("file-changed", vi.fn());
    teardown();

    await vi.waitFor(() => expect(unlisten).toHaveBeenCalledTimes(1));
  });

  it("swallows a rejected unlisten so it never escapes as an unhandled rejection", async () => {
    // The real Tauri unlisten rejects when the listener was already removed
    // (window closing, double teardown). The teardown must absorb it.
    vi.mocked(listen).mockResolvedValue(() => {
      throw new Error("undefined is not an object (evaluating 'listeners[eventId].handlerId')");
    });

    const teardown = subscribe("file-changed", vi.fn());

    await expect(Promise.resolve(teardown())).resolves.toBeUndefined();
  });

  it("does not throw when teardown runs before the listen promise resolves", async () => {
    let rejectUnlisten: ((reason: unknown) => void) | undefined;
    vi.mocked(listen).mockReturnValue(
      new Promise((_, reject) => {
        rejectUnlisten = reject;
      }),
    );

    const teardown = subscribe("file-changed", vi.fn());
    expect(() => teardown()).not.toThrow();

    // Reject the pending listen promise; the teardown's catch must absorb it.
    rejectUnlisten?.(new Error("listen failed"));
    await expect(Promise.resolve()).resolves.toBeUndefined();
  });
});
