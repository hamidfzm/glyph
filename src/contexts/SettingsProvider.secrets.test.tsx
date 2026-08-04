import { invoke } from "@tauri-apps/api/core";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsProvider } from "@/contexts/SettingsProvider";
import { mockStore, resetSettingsDom, TestConsumer, UpdateConsumer } from "@/test/settingsHarness";

beforeEach(() => {
  vi.clearAllMocks();
  resetSettingsDom();
});

describe("API key secret handling", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(invoke).mockReset();
  });

  // Stateful keychain fake keyed by provider: secret_set records,
  // secret_get reads back (names are ai-api-key-<provider>).
  function mockKeychain(initial: Record<string, string> = {}) {
    const stored: Record<string, string> = { ...initial };
    vi.mocked(invoke).mockImplementation(async (cmd, args) => {
      const a = args as { name: string; value?: string };
      const provider = a.name.replace("ai-api-key-", "");
      if (cmd === "secret_set") {
        if (a.value) stored[provider] = a.value;
        else delete stored[provider];
        return undefined;
      }
      if (cmd === "secret_get") return stored[provider] ?? null;
      return undefined;
    });
    return stored;
  }

  it("loads stored keys from the keychain into memory", async () => {
    mockStore(null);
    mockKeychain({ claude: "sk-stored" });

    render(
      <SettingsProvider>
        <TestConsumer />
      </SettingsProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("loaded").textContent).toBe("true");
    });

    expect(screen.getByTestId("claude-key").textContent).toBe("sk-stored");
  });

  it("migrates legacy plaintext keys to the keychain and strips the store copy", async () => {
    const { set } = mockStore({ ai: { apiKeys: { claude: "sk-legacy" } } });
    const stored = mockKeychain();

    render(
      <SettingsProvider>
        <TestConsumer />
      </SettingsProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("loaded").textContent).toBe("true");
    });

    // The plaintext key moved into the keychain and stayed usable in memory.
    expect(stored.claude).toBe("sk-legacy");
    expect(screen.getByTestId("claude-key").textContent).toBe("sk-legacy");
    // The store was rewritten without the plaintext copy.
    expect(set).toHaveBeenCalledWith(
      "settings",
      expect.objectContaining({ ai: expect.objectContaining({ apiKeys: {} }) }),
    );
  });

  it("keeps the key in memory and the store untouched when migration fails", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { set } = mockStore({ ai: { apiKeys: { claude: "sk-legacy" } } });
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "secret_set") throw new Error("keyring locked");
      if (cmd === "secret_get") return null;
      return undefined;
    });

    render(
      <SettingsProvider>
        <TestConsumer />
      </SettingsProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("loaded").textContent).toBe("true");
    });

    // The only copy of the key is preserved for the session and on disk.
    expect(screen.getByTestId("claude-key").textContent).toBe("sk-legacy");
    expect(set).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("logs when removing the migrated plaintext copy from the store fails", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockStore({ ai: { apiKeys: { claude: "sk-legacy" } } }, { setRejects: true });
    mockKeychain();

    render(
      <SettingsProvider>
        <TestConsumer />
      </SettingsProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("loaded").textContent).toBe("true");
    });

    expect(errSpy).toHaveBeenCalledWith(
      "Failed to remove migrated API keys from settings.json:",
      expect.any(Error),
    );
    errSpy.mockRestore();
  });

  it("logs when clearing a keychain entry on reset fails", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockStore(null);
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "secret_set") throw new Error("keyring locked");
      return null;
    });

    render(
      <SettingsProvider>
        <TestConsumer />
      </SettingsProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("loaded").textContent).toBe("true");
    });

    act(() => screen.getByTestId("reset").click());

    await waitFor(() => {
      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to clear the"),
        expect.any(Error),
      );
    });
    errSpy.mockRestore();
  });

  it("strips API keys from every persisted settings write", async () => {
    const { set } = mockStore(null);
    mockKeychain();

    render(
      <SettingsProvider>
        <UpdateConsumer updates={[["ai.apiKeys", { claude: "sk-typed" }]]} />
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
    });

    expect(set).toHaveBeenCalledWith(
      "settings",
      expect.objectContaining({ ai: expect.objectContaining({ apiKeys: {} }) }),
    );
  });

  it("clears keychain entries on reset", async () => {
    mockStore(null);
    const stored = mockKeychain({ claude: "sk-a", openai: "sk-b" });

    render(
      <SettingsProvider>
        <TestConsumer />
      </SettingsProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("loaded").textContent).toBe("true");
    });

    act(() => screen.getByTestId("reset").click());

    await waitFor(() => {
      expect(stored).toEqual({});
    });
  });
});
