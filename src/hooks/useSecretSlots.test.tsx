import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsContext, type SettingsContextValue } from "@/contexts/SettingsContext";
import { useSecretSlots } from "@/hooks/useSecretSlots";
import { scheduleAiKeyWrite } from "@/lib/aiKeyWrites";
import { SECRET_SLOTS, type SecretSlot, SYNC_TOKEN_SLOT } from "@/lib/secretSlots";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { expectConsole } from "@/test/consoleGuard";
import { deferred } from "@/test/deferred";

const { hasSecretMock, setSecretMock, workspaceRootMock } = vi.hoisted(() => ({
  hasSecretMock: vi.fn(),
  setSecretMock: vi.fn(),
  workspaceRootMock: vi.fn(),
}));
const { hasSyncTokenMock, setSyncTokenMock, clearSyncTokenMock } = vi.hoisted(() => ({
  hasSyncTokenMock: vi.fn(),
  setSyncTokenMock: vi.fn(),
  clearSyncTokenMock: vi.fn(),
}));

vi.mock("@/lib/secrets", () => ({
  getSecret: vi.fn(),
  setSecret: setSecretMock,
  hasSecret: hasSecretMock,
}));
vi.mock("@/lib/syncCommands", () => ({
  hasSyncToken: hasSyncTokenMock,
  setSyncToken: setSyncTokenMock,
  clearSyncToken: clearSyncTokenMock,
}));
vi.mock("@/contexts/TabsContext", () => ({ useWorkspaceRoot: workspaceRootMock }));

const CLAUDE_SLOT = SECRET_SLOTS.find((s) => s.id === "ai-claude") as SecretSlot;

let updateSettings: ReturnType<typeof vi.fn<(path: string, value: unknown) => void>>;

function wrapperWith(apiKeys: Record<string, string>) {
  const value: SettingsContextValue = {
    settings: { ...DEFAULT_SETTINGS, ai: { ...DEFAULT_SETTINGS.ai, apiKeys } },
    updateSettings,
    resetSettings: vi.fn(),
    flushSettings: async () => true,
    loaded: true,
  };
  return ({ children }: { children: ReactNode }) => (
    <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
  );
}

function renderSlots(apiKeys: Record<string, string> = {}) {
  return renderHook(() => useSecretSlots(), { wrapper: wrapperWith(apiKeys) });
}

beforeEach(() => {
  updateSettings = vi.fn<(path: string, value: unknown) => void>();
  hasSecretMock.mockReset().mockResolvedValue(false);
  setSecretMock.mockReset().mockResolvedValue(undefined);
  hasSyncTokenMock.mockReset().mockResolvedValue(false);
  setSyncTokenMock.mockReset().mockResolvedValue(undefined);
  clearSyncTokenMock.mockReset().mockResolvedValue(undefined);
  workspaceRootMock.mockReset().mockReturnValue("/ws");
});

describe("useSecretSlots", () => {
  it("reports which slots are filled without reading any value", async () => {
    hasSecretMock.mockImplementation((name: string) =>
      Promise.resolve(name === "ai-api-key-claude"),
    );
    hasSyncTokenMock.mockResolvedValue(true);

    const { result } = renderSlots();

    await waitFor(() => expect(result.current.presence["ai-claude"]).toBe(true));
    expect(result.current.presence["ai-openai"]).toBe(false);
    expect(result.current.presence["sync-token"]).toBe(true);
    expect(result.current.errorKey).toBeNull();
    // Presence is asked for, never the value.
    expect(hasSecretMock).toHaveBeenCalledWith("ai-api-key-claude");
    expect(hasSyncTokenMock).toHaveBeenCalledWith("/ws");
  });

  it("leaves the sync slot unknown and unqueried when no folder is open", async () => {
    workspaceRootMock.mockReturnValue(undefined);

    const { result } = renderSlots();

    await waitFor(() => expect(result.current.presence["ai-claude"]).toBe(false));
    expect(result.current.presence["sync-token"]).toBeNull();
    expect(hasSyncTokenMock).not.toHaveBeenCalled();
    expect(result.current.errorKey).toBeNull();
  });

  it("surfaces a keychain read failure instead of reporting the slot as unset", async () => {
    expectConsole(/Failed to check the ai-claude secret slot/);
    hasSecretMock.mockImplementation((name: string) =>
      name === "ai-api-key-claude"
        ? Promise.reject(new Error("keychain read failed"))
        : Promise.resolve(false),
    );

    const { result } = renderSlots();

    await waitFor(() => expect(result.current.errorKey).not.toBeNull());
    expect(result.current.presence["ai-claude"]).toBeNull();
    expect(result.current.presence["ai-openai"]).toBe(false);
  });

  it("removes one provider key without touching the others", async () => {
    hasSecretMock.mockResolvedValue(true);
    const { result } = renderSlots({ claude: "sk-ant", openai: "sk-oai" });
    await waitFor(() => expect(result.current.presence["ai-claude"]).toBe(true));

    await act(() => result.current.remove(CLAUDE_SLOT));

    expect(setSecretMock).toHaveBeenCalledWith("ai-api-key-claude", "");
    expect(updateSettings).toHaveBeenCalledWith("ai.apiKeys", { openai: "sk-oai" });
    expect(result.current.presence["ai-claude"]).toBe(false);
    expect(result.current.presence["ai-openai"]).toBe(true);
  });

  it("drops a keystroke write queued elsewhere so removal is not undone", async () => {
    vi.useFakeTimers();
    try {
      hasSecretMock.mockResolvedValue(true);
      const { result } = renderSlots({ claude: "sk-ant" });
      await act(() => vi.advanceTimersByTimeAsync(0));

      // The AI tab queues a debounced write, then the key is removed here.
      scheduleAiKeyWrite("claude", "sk-ant-typed", vi.fn());
      await act(() => result.current.remove(CLAUDE_SLOT));
      await act(() => vi.advanceTimersByTimeAsync(600));

      expect(setSecretMock).toHaveBeenCalledExactlyOnceWith("ai-api-key-claude", "");
      expect(result.current.presence["ai-claude"]).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays consistent when the same slot is removed twice", async () => {
    hasSecretMock.mockResolvedValue(true);
    const { result } = renderSlots({ claude: "sk-ant" });
    await waitFor(() => expect(result.current.presence["ai-claude"]).toBe(true));

    await act(async () => {
      await Promise.all([result.current.remove(CLAUDE_SLOT), result.current.remove(CLAUDE_SLOT)]);
    });

    expect(setSecretMock).toHaveBeenCalledTimes(2);
    expect(result.current.presence["ai-claude"]).toBe(false);
    expect(result.current.busySlotId).toBeNull();
  });

  it("marks the slot unknown when removal fails", async () => {
    expectConsole(/Failed to update the ai-claude secret slot/);
    hasSecretMock.mockResolvedValue(true);
    setSecretMock.mockRejectedValue(new Error("keychain delete failed"));
    const { result } = renderSlots({ claude: "sk-ant" });
    await waitFor(() => expect(result.current.presence["ai-claude"]).toBe(true));

    await act(() => result.current.remove(CLAUDE_SLOT));

    expect(result.current.presence["ai-claude"]).toBeNull();
    expect(result.current.errorKey).toBe("secrets.errors.remove");
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("clears the sync token through the guarded sync command", async () => {
    hasSyncTokenMock.mockResolvedValue(true);
    const { result } = renderSlots();
    await waitFor(() => expect(result.current.presence["sync-token"]).toBe(true));

    await act(() => result.current.remove(SYNC_TOKEN_SLOT));

    expect(clearSyncTokenMock).toHaveBeenCalledWith("/ws");
    expect(result.current.presence["sync-token"]).toBe(false);
  });

  it("replaces a provider key from the same place", async () => {
    const { result } = renderSlots({ openai: "sk-oai" });
    await waitFor(() => expect(result.current.presence["ai-claude"]).toBe(false));

    await act(() => result.current.save(CLAUDE_SLOT, "sk-ant-new"));

    expect(setSecretMock).toHaveBeenCalledWith("ai-api-key-claude", "sk-ant-new");
    expect(updateSettings).toHaveBeenCalledWith("ai.apiKeys", {
      openai: "sk-oai",
      claude: "sk-ant-new",
    });
    expect(result.current.presence["ai-claude"]).toBe(true);
  });

  it("replaces the sync token from the same place", async () => {
    const { result } = renderSlots();
    await waitFor(() => expect(result.current.presence["sync-token"]).toBe(false));

    await act(() => result.current.save(SYNC_TOKEN_SLOT, "ghp_new"));

    expect(setSyncTokenMock).toHaveBeenCalledWith("/ws", "ghp_new");
    expect(result.current.presence["sync-token"]).toBe(true);
  });

  it("does not touch the sync slot when no folder is open", async () => {
    workspaceRootMock.mockReturnValue(undefined);
    const { result } = renderSlots();
    await waitFor(() => expect(result.current.presence["ai-claude"]).toBe(false));

    await act(() => result.current.remove(SYNC_TOKEN_SLOT));
    await act(() => result.current.save(SYNC_TOKEN_SLOT, "ghp_new"));

    expect(clearSyncTokenMock).not.toHaveBeenCalled();
    expect(setSyncTokenMock).not.toHaveBeenCalled();
    expect(result.current.presence["sync-token"]).toBeNull();
  });

  it("does not let a slow lookup overwrite a write that already landed", async () => {
    const slow = deferred<boolean>();
    hasSecretMock.mockImplementation((name: string) =>
      name === "ai-api-key-claude" ? slow.promise : Promise.resolve(false),
    );
    const { result } = renderSlots();

    // The replacement lands while the initial presence batch is still open.
    await act(() => result.current.save(CLAUDE_SLOT, "sk-ant-new"));
    expect(result.current.presence["ai-claude"]).toBe(true);

    await act(async () => {
      slow.resolve(false);
      await slow.promise;
    });
    expect(result.current.presence["ai-claude"]).toBe(true);
  });

  it("finishes a write issued before the tab unmounted", async () => {
    const inFlight = deferred();
    setSecretMock.mockReturnValueOnce(inFlight.promise);
    const { result, unmount } = renderSlots({ claude: "sk-ant" });
    await waitFor(() => expect(result.current.presence["ai-claude"]).toBe(false));

    let removal!: Promise<void>;
    act(() => {
      removal = result.current.remove(CLAUDE_SLOT);
    });
    unmount();
    inFlight.resolve();
    await removal;

    expect(setSecretMock).toHaveBeenCalledWith("ai-api-key-claude", "");
  });

  it("does not let a previous workspace's answer land on the new one", async () => {
    const slow = deferred<boolean>();
    hasSyncTokenMock.mockImplementation((path: string) =>
      path === "/old" ? slow.promise : Promise.resolve(true),
    );
    workspaceRootMock.mockReturnValue("/old");
    const { result, rerender } = renderSlots();

    workspaceRootMock.mockReturnValue("/new");
    rerender();
    await waitFor(() => expect(result.current.presence["sync-token"]).toBe(true));

    // The stale lookup answers last and must be ignored.
    await act(async () => {
      slow.resolve(false);
      await slow.promise;
    });
    expect(result.current.presence["sync-token"]).toBe(true);
  });
});
