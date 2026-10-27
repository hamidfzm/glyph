import { invoke } from "@tauri-apps/api/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsContext, type SettingsContextValue } from "@/contexts/SettingsContext";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import type { SettingsRepoConfig, SettingsSyncOutcome } from "@/lib/settingsSync";
import { routeInvoke, status, syncResult } from "@/test/fixtures/sync";
import { SettingsSyncTab } from "./SettingsSyncTab";

const flushSettings = vi.fn(async () => true);

function repo(overrides: Partial<SettingsRepoConfig> = {}): SettingsRepoConfig {
  return {
    remoteUrl: "https://example.com/setup.git",
    branch: "main",
    author: null,
    phase: "active",
    ...overrides,
  };
}

function outcome(overrides: Partial<SettingsSyncOutcome> = {}): SettingsSyncOutcome {
  return {
    phase: "active",
    result: syncResult({ pulledCount: 1 }),
    conflicts: [],
    skipped: [],
    plugins: { plugins: [], removals: [] },
    ...overrides,
  };
}

/** Route the settings repo's commands, with `config` as what is connected. */
function backend(initial: SettingsRepoConfig | null, handlers: Record<string, () => unknown> = {}) {
  let config = initial;
  routeInvoke({
    settings_sync_get_config: () => config,
    settings_sync_default_author: () => ({ name: "Ada", email: "ada@example.com" }),
    settings_sync_has_token: () => false,
    settings_sync_status: () => status(),
    settings_sync_plugin_plan: () => ({ plugins: [], removals: [] }),
    ...handlers,
  });
  return {
    connect(next: SettingsRepoConfig | null) {
      config = next;
    },
  };
}

function renderTab() {
  const value = {
    settings: DEFAULT_SETTINGS,
    updateSettings: vi.fn(),
    resetSettings: vi.fn(),
    flushSettings,
    loaded: true,
  } as SettingsContextValue;
  return render(
    <SettingsContext.Provider value={value}>
      <SettingsSyncTab />
    </SettingsContext.Provider>,
  );
}

function calls(command: string) {
  return vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === command);
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  flushSettings.mockClear();
});

describe("SettingsSyncTab", () => {
  it("connects from the form, writing pending settings first", async () => {
    const remote = backend(null, {
      settings_sync_connect: () => {
        remote.connect(repo());
        return outcome({ result: syncResult({ pushedCount: 1 }) });
      },
    });
    renderTab();
    const connect = await screen.findByRole("button", { name: "Connect" });
    expect(connect).toBeDisabled();
    expect(screen.queryByText("Conflict policy")).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("https://github.com/you/glyph-setup.git"), {
      target: { value: "https://example.com/setup.git" },
    });
    fireEvent.change(screen.getByPlaceholderText("ghp_…"), { target: { value: "tok" } });
    fireEvent.click(connect);

    await screen.findByText("https://example.com/setup.git");
    expect(calls("settings_sync_connect")[0][1]).toEqual({
      remoteUrl: "https://example.com/setup.git",
      branch: "main",
      author: null,
      token: "tok",
    });
    const connectAt = vi
      .mocked(invoke)
      .mock.calls.findIndex(([cmd]) => cmd === "settings_sync_connect");
    expect(flushSettings.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(invoke).mock.invocationCallOrder[connectAt],
    );
    expect(screen.getByPlaceholderText(/leave blank to keep/)).toBeInTheDocument();
  });

  it("keeps the form and shows why when a connect fails", async () => {
    backend(null, {
      settings_sync_connect: () => {
        throw { kind: "network", message: "unreachable" };
      },
    });
    renderTab();
    fireEvent.change(await screen.findByPlaceholderText("https://github.com/you/glyph-setup.git"), {
      target: { value: "https://example.com/setup.git" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't reach the remote");
    expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
  });

  it("asks which setup to start from and does nothing until one is picked", async () => {
    const remote = backend(repo({ phase: "choosing" }), {
      settings_sync_choose: () => {
        remote.connect(repo());
        return outcome();
      },
    });
    renderTab();
    expect(await screen.findByText("This repository already holds a Glyph setup")).toBeVisible();
    expect(calls("settings_sync_choose")).toEqual([]);
    expect(calls("settings_sync_status")).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Replace it with this machine's" }));
    await screen.findByRole("button", { name: "Sync now" });
    expect(calls("settings_sync_choose")[0][1]).toEqual({ choice: "replace-synced" });
    expect(flushSettings).toHaveBeenCalled();
  });

  it("takes the synced setup on the other answer", async () => {
    const remote = backend(repo({ phase: "choosing" }), {
      settings_sync_choose: () => {
        remote.connect(repo());
        return outcome();
      },
    });
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Use the synced setup" }));
    await screen.findByRole("button", { name: "Sync now" });
    expect(calls("settings_sync_choose")[0][1]).toEqual({ choice: "use-synced" });
  });

  it("drops a load that finishes after the tab closed", async () => {
    backend(repo());
    const { unmount } = renderTab();
    unmount();
    await waitFor(() => expect(calls("settings_sync_has_token")).toHaveLength(1));
  });

  it("can still disconnect while the choice is open", async () => {
    const remote = backend(repo({ phase: "choosing" }), {
      settings_sync_disconnect: () => remote.connect(null),
    });
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    expect(await screen.findByRole("button", { name: "Connect" })).toBeInTheDocument();
    expect(calls("settings_sync_choose")).toEqual([]);
  });

  it("says why the repo could not be read, and shrugs off the advisory reads", async () => {
    backend(null, {
      settings_sync_get_config: () => {
        throw { kind: "io", message: "config unreadable" };
      },
      settings_sync_default_author: () => {
        throw { kind: "backend" };
      },
      settings_sync_has_token: () => {
        throw { kind: "backend" };
      },
    });
    renderTab();
    expect(await screen.findByRole("alert")).toHaveTextContent("config unreadable");
    expect(screen.getByPlaceholderText("defaults to your git config")).toBeInTheDocument();
  });

  it("stays usable when the status and plugin plan cannot be read", async () => {
    backend(repo(), {
      settings_sync_status: () => {
        throw { kind: "io" };
      },
      settings_sync_plugin_plan: () => {
        throw { kind: "io" };
      },
    });
    renderTab();
    expect(await screen.findByRole("button", { name: "Sync now" })).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the conflicts a sync stopped on", async () => {
    backend(repo(), {
      settings_sync_run: () =>
        outcome({
          conflicts: ["settings/editor.json"],
          result: syncResult({ conflicts: ["settings/editor.json"] }),
        }),
    });
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Sync now" }));
    expect(
      await screen.findByRole("group", { name: "Version of Editor settings to keep" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync now" })).toBeDisabled();
  });

  it("syncs now and lists the files the sync left out", async () => {
    backend(repo(), {
      settings_sync_run: () =>
        outcome({ skipped: [{ path: "settings/ai.json", reason: "not-a-file" }] }),
    });
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Sync now" }));
    expect(await screen.findByText("AI settings: not a plain file")).toBeInTheDocument();
    expect(flushSettings).toHaveBeenCalled();
    expect(calls("settings_sync_run")).toHaveLength(1);
  });

  it("waits for a side for every conflicted file before resolving", async () => {
    const conflicted = ["plugins/com.x.demo.json", "settings/appearance.json"];
    let open = conflicted;
    backend(repo(), {
      settings_sync_status: () => status({ conflicts: open }),
      settings_sync_resolve: () => {
        open = [];
        return outcome();
      },
    });
    renderTab();
    const resolve = await screen.findByRole("button", { name: "Resolve" });
    expect(screen.getByRole("button", { name: "Sync now" })).toBeDisabled();
    expect(resolve).toBeDisabled();

    const appearance = screen.getByRole("group", {
      name: "Version of Appearance settings to keep",
    });
    fireEvent.click(appearance.querySelectorAll("button")[0]);
    expect(resolve).toBeDisabled();
    const plugin = screen.getByRole("group", { name: "Version of Plugin com.x.demo to keep" });
    fireEvent.click(plugin.querySelectorAll("button")[1]);
    expect(resolve).toBeEnabled();
    fireEvent.click(resolve);

    await waitFor(() => expect(screen.queryByRole("button", { name: "Resolve" })).toBeNull());
    expect(calls("settings_sync_resolve")[0][1]).toEqual({
      picks: [
        { path: "plugins/com.x.demo.json", side: "remote" },
        { path: "settings/appearance.json", side: "local" },
      ],
    });
  });

  it("disconnects back to the setup form", async () => {
    const remote = backend(repo(), {
      settings_sync_disconnect: () => remote.connect(null),
    });
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    expect(await screen.findByRole("button", { name: "Connect" })).toBeInTheDocument();
  });

  it("reports an operation the backend refuses", async () => {
    backend(repo(), {
      settings_sync_run: () => {
        throw { kind: "busy" };
      },
    });
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Sync now" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A sync is already running");
  });

  it("saves and removes the token of an https remote", async () => {
    backend(repo(), {
      settings_sync_has_token: () => true,
      settings_sync_set_token: () => undefined,
      settings_sync_clear_token: () => undefined,
    });
    renderTab();
    fireEvent.change(await screen.findByPlaceholderText(/leave blank to keep/), {
      target: { value: " new-token " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save token" }));
    await waitFor(() =>
      expect(calls("settings_sync_set_token")[0][1]).toEqual({ token: "new-token" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Remove/ }));
    await waitFor(() => expect(calls("settings_sync_clear_token")).toHaveLength(1));
  });

  it("offers no token for an ssh remote", async () => {
    backend(repo({ remoteUrl: "git@example.com:you/setup.git" }));
    renderTab();
    await screen.findByRole("button", { name: "Sync now" });
    expect(screen.queryByText("Personal access token")).not.toBeInTheDocument();
  });
});
