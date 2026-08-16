import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSyncTokenPresence } from "@/hooks/useSyncTokenPresence";
import { expectConsole } from "@/test/consoleGuard";
import { deferred } from "@/test/deferred";

const { hasSyncTokenMock } = vi.hoisted(() => ({ hasSyncTokenMock: vi.fn() }));
vi.mock("@/lib/syncCommands", () => ({ hasSyncToken: hasSyncTokenMock }));

beforeEach(() => {
  hasSyncTokenMock.mockReset().mockResolvedValue(false);
});

describe("useSyncTokenPresence", () => {
  it("reports presence without reading the token", async () => {
    hasSyncTokenMock.mockResolvedValue(true);

    const { result } = renderHook(() => useSyncTokenPresence("/ws"));

    await waitFor(() => expect(result.current.tokenStored).toBe(true));
    expect(hasSyncTokenMock).toHaveBeenCalledExactlyOnceWith("/ws");
  });

  it("stays unknown and unqueried when no folder is open", async () => {
    const { result } = renderHook(() => useSyncTokenPresence(undefined));

    await waitFor(() => expect(result.current.tokenStored).toBeNull());
    expect(hasSyncTokenMock).not.toHaveBeenCalled();
  });

  it("reports a keychain failure as unknown, not as absent", async () => {
    // A locked keyring must not tell the user a stored token is gone.
    expectConsole(/Failed to check the sync token/);
    hasSyncTokenMock.mockRejectedValue(new Error("keychain locked"));

    const { result } = renderHook(() => useSyncTokenPresence("/ws"));

    await waitFor(() => expect(result.current.tokenStored).toBeNull());
  });

  it("does not let a previous workspace's answer land on the new one", async () => {
    const slow = deferred<boolean>();
    hasSyncTokenMock.mockImplementation((path: string) =>
      path === "/old" ? slow.promise : Promise.resolve(true),
    );
    const { result, rerender } = renderHook(({ path }) => useSyncTokenPresence(path), {
      initialProps: { path: "/old" },
    });

    rerender({ path: "/new" });
    await waitFor(() => expect(result.current.tokenStored).toBe(true));

    // The stale lookup answers last and must be ignored.
    await act(async () => {
      slow.resolve(false);
      await slow.promise;
    });
    expect(result.current.tokenStored).toBe(true);
  });

  it("re-reads the keychain on refresh, so a write is reflected", async () => {
    const { result } = renderHook(() => useSyncTokenPresence("/ws"));
    await waitFor(() => expect(result.current.tokenStored).toBe(false));

    hasSyncTokenMock.mockResolvedValue(true);
    await act(() => result.current.refresh());

    expect(result.current.tokenStored).toBe(true);
    expect(hasSyncTokenMock).toHaveBeenCalledTimes(2);
  });
});
