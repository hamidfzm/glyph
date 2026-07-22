import { captureException } from "@sentry/react";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWindowClose } from "./useWindowClose";

vi.mock("@sentry/react", () => ({ captureException: vi.fn() }));

// Mock the Tauri window API. `onCloseRequested` captures the handler the hook
// registers so tests can fire a synthetic close request; `close` is asserted on.
const { getCurrentWindow, onCloseRequested, close } = vi.hoisted(() => {
  const onCloseRequested = vi.fn();
  const close = vi.fn(() => Promise.resolve());
  return {
    getCurrentWindow: vi.fn(() => ({ onCloseRequested, close })),
    onCloseRequested,
    close,
  };
});
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow }));

type CloseHandler = (event: { preventDefault: () => void }) => void | Promise<void>;

let handler: CloseHandler | undefined;
let unlisten: ReturnType<typeof vi.fn>;

describe("useWindowClose", () => {
  beforeEach(() => {
    handler = undefined;
    unlisten = vi.fn();
    close.mockClear();
    vi.mocked(captureException).mockClear();
    getCurrentWindow.mockClear();
    getCurrentWindow.mockReturnValue({ onCloseRequested, close });
    onCloseRequested.mockClear();
    onCloseRequested.mockImplementation((fn: CloseHandler) => {
      handler = fn;
      return Promise.resolve(unlisten);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Let the effect's onCloseRequested().then(...) settle so `unlisten` is stored.
  async function settle() {
    await Promise.resolve();
    await Promise.resolve();
  }

  it("closes the window once the flush approves", async () => {
    const flush = vi.fn().mockResolvedValue(true);
    renderHook(() => useWindowClose(flush));
    await settle();

    const event = { preventDefault: vi.fn() };
    await handler?.(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(flush).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("closes the window and reports when the flush rejects (never traps the user)", async () => {
    const error = new Error("save failed");
    const flush = vi.fn().mockRejectedValue(error);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    renderHook(() => useWindowClose(flush));
    await settle();

    const event = { preventDefault: vi.fn() };
    await handler?.(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(flush).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(error);
    consoleError.mockRestore();
  });

  it("keeps the window open when the flush is cancelled", async () => {
    const flush = vi.fn().mockResolvedValue(false);
    renderHook(() => useWindowClose(flush));
    await settle();

    const event = { preventDefault: vi.fn() };
    await handler?.(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it("lets the re-issued close pass through without prompting again", async () => {
    const flush = vi.fn().mockResolvedValue(true);
    renderHook(() => useWindowClose(flush));
    await settle();

    await handler?.({ preventDefault: vi.fn() });
    // The close() above re-triggers onCloseRequested; that second pass is ours.
    const second = { preventDefault: vi.fn() };
    await handler?.(second);

    expect(second.preventDefault).not.toHaveBeenCalled();
    expect(flush).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("stops listening on unmount", async () => {
    const { unmount } = renderHook(() => useWindowClose(vi.fn()));
    await settle();

    unmount();

    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("unlistens immediately when unmounted before registration resolves", async () => {
    // Park the onCloseRequested promise so the effect's cleanup runs first.
    let resolveRegister!: (fn: () => void) => void;
    onCloseRequested.mockReturnValue(
      new Promise<() => void>((r) => {
        resolveRegister = r;
      }),
    );
    const { unmount } = renderHook(() => useWindowClose(vi.fn()));

    unmount();
    resolveRegister(unlisten as unknown as () => void);
    await settle();

    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the window API is unavailable", async () => {
    getCurrentWindow.mockImplementationOnce(() => {
      throw new Error("no window API");
    });
    const flush = vi.fn().mockResolvedValue(true);

    expect(() => renderHook(() => useWindowClose(flush))).not.toThrow();
    await settle();

    expect(onCloseRequested).not.toHaveBeenCalled();
    expect(flush).not.toHaveBeenCalled();
  });
});
