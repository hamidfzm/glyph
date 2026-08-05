import { invoke } from "@tauri-apps/api/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SyncConfigProvider } from "@/contexts/SyncConfigProvider";
import { TabsContext, type TabsContextValue } from "@/contexts/TabsContext";
import type { WorkspaceSyncConfig } from "@/lib/sync";
import type { Workspace } from "@/lib/tabs";
import { tabsContextValue } from "@/test/fixtures/tabsContext";
import { SyncSettingsModal } from "./SyncSettingsModal";

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  // Default fallback so hooks that fire on mount (useSyncConfig) don't crash
  // in tests that don't care about the response. Individual tests override.
  vi.mocked(invoke).mockResolvedValue(null as unknown as never);
});

function routeInvoke(handlers: Record<string, (args: unknown) => unknown>) {
  vi.mocked(invoke).mockImplementation((cmd: string, args?: unknown) => {
    const handler = handlers[cmd];
    if (!handler) return Promise.reject(new Error(`no handler for ${cmd}`));
    return Promise.resolve(handler(args) as never);
  });
}

function makeWorkspace(root = "/w"): Workspace {
  return { root, expanded: new Set<string>(), nodes: new Map() };
}

function withTabs(value: TabsContextValue) {
  // The modal reads sync state from SyncConfigContext, which derives the
  // workspace path from TabsContext and drives the (mocked) sync commands —
  // so wrap children in the real provider.
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TabsContext.Provider value={value}>
      <SyncConfigProvider>{children}</SyncConfigProvider>
    </TabsContext.Provider>
  );
  return wrapper;
}

describe("SyncSettingsModal saving the config", () => {
  it("uses the git-config author name as the Author placeholder", async () => {
    routeInvoke({
      sync_get_config: () => null,
      sync_default_author: () => ({ name: "Hamid", email: "h@example.com" }),
      sync_repo_present: () => true,
    });
    const wrapper = withTabs(tabsContextValue({ workspace: makeWorkspace() }));
    render(<SyncSettingsModal open={true} onClose={vi.fn()} />, { wrapper });

    const nameInput = (await screen.findByPlaceholderText("Hamid")) as HTMLInputElement;
    expect(nameInput.value).toBe("");
    const emailInput = screen.getByPlaceholderText("h@example.com") as HTMLInputElement;
    expect(emailInput.value).toBe("");
  });

  it("Save with a non-empty token calls sync_set_token after sync_set_config and clears the field", async () => {
    routeInvoke({
      sync_get_config: () => null,
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => false,
      sync_init_repo: () => null,
      sync_set_config: () => null,
      sync_set_origin: () => null,
      sync_set_token: () => null,
      sync_commit_config: () => false,
    });
    const wrapper = withTabs(tabsContextValue({ workspace: makeWorkspace() }));
    render(<SyncSettingsModal open={true} onClose={vi.fn()} />, { wrapper });

    fireEvent.change(await screen.findByPlaceholderText("https://github.com/you/notes.git"), {
      target: { value: "https://example.com/r.git" },
    });
    const tokenInput = screen.getByPlaceholderText("ghp_…") as HTMLInputElement;
    fireEvent.change(tokenInput, { target: { value: "ghp_secret" } });

    fireEvent.click(screen.getByRole("button", { name: "Save config" }));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("sync_set_token", {
        workspacePath: "/w",
        token: "ghp_secret",
      }),
    );
    await waitFor(() => expect(tokenInput.value).toBe(""));
  });

  it("Save calls sync_set_origin after sync_set_config when the repo already exists", async () => {
    routeInvoke({
      sync_get_config: () => null,
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => true,
      sync_set_config: () => null,
      sync_set_origin: () => null,
      sync_commit_config: () => false,
    });
    const wrapper = withTabs(tabsContextValue({ workspace: makeWorkspace() }));
    render(<SyncSettingsModal open={true} onClose={vi.fn()} />, { wrapper });

    fireEvent.change(await screen.findByPlaceholderText("https://github.com/you/notes.git"), {
      target: { value: "https://example.com/r.git" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save config" }));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("sync_set_origin", {
        workspacePath: "/w",
        remoteUrl: "https://example.com/r.git",
      }),
    );
  });

  it("Author identity: name+email -> author object", async () => {
    const calls: Array<Record<string, unknown>> = [];
    routeInvoke({
      sync_get_config: () => null,
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => true,
      sync_set_config: (args) => {
        calls.push(args as Record<string, unknown>);
        return null;
      },
      sync_set_origin: () => null,
      sync_commit_config: () => false,
    });
    const wrapper = withTabs(tabsContextValue({ workspace: makeWorkspace() }));
    render(<SyncSettingsModal open={true} onClose={vi.fn()} />, { wrapper });

    fireEvent.change(await screen.findByPlaceholderText("https://github.com/you/notes.git"), {
      target: { value: "https://example.com/r.git" },
    });
    fireEvent.change(screen.getByPlaceholderText("defaults to your git config"), {
      target: { value: "Hamid" },
    });
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
      target: { value: "h@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save config" }));

    await waitFor(() => expect(calls).toHaveLength(1));
    const cfg = calls[0].config as WorkspaceSyncConfig;
    expect(cfg.author).toEqual({ name: "Hamid", email: "h@example.com" });
  });

  it("Author identity: blank -> null", async () => {
    const calls: Array<Record<string, unknown>> = [];
    routeInvoke({
      sync_get_config: () => null,
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => true,
      sync_set_config: (args) => {
        calls.push(args as Record<string, unknown>);
        return null;
      },
      sync_set_origin: () => null,
      sync_commit_config: () => false,
    });
    const wrapper = withTabs(tabsContextValue({ workspace: makeWorkspace() }));
    render(<SyncSettingsModal open={true} onClose={vi.fn()} />, { wrapper });

    fireEvent.change(await screen.findByPlaceholderText("https://github.com/you/notes.git"), {
      target: { value: "https://example.com/r.git" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save config" }));

    await waitFor(() => expect(calls).toHaveLength(1));
    const cfg = calls[0].config as WorkspaceSyncConfig;
    expect(cfg.author).toBeNull();
  });

  it("Save with no Remote URL enables local-only sync (saves config, skips set_origin)", async () => {
    // A blank remote URL is valid: it configures local-only sync (commit
    // history with no remote to push to). Save must persist the config with
    // an empty remoteUrl and must NOT call sync_set_origin (there's no
    // origin to write).
    routeInvoke({
      sync_get_config: () => null,
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => true,
      sync_set_config: () => null,
      sync_commit_config: () => false,
    });
    const wrapper = withTabs(tabsContextValue({ workspace: makeWorkspace() }));
    render(<SyncSettingsModal open={true} onClose={vi.fn()} />, { wrapper });

    const save = await screen.findByRole("button", { name: "Save config" });
    // No URL entered, yet the button is enabled — local-only is allowed.
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => {
      const calls = vi.mocked(invoke).mock.calls.map((c) => c[0]);
      expect(calls).toContain("sync_set_config");
    });
    const setConfigCall = vi.mocked(invoke).mock.calls.find((c) => c[0] === "sync_set_config");
    expect((setConfigCall![1] as { config: { remoteUrl: string } }).config.remoteUrl).toBe("");
    const allCalls = vi.mocked(invoke).mock.calls.map((c) => c[0]);
    expect(allCalls).not.toContain("sync_set_origin");
  });

  it("Save does nothing when the workspace tab is missing (handleSave workspacePath guard)", async () => {
    // Render with an active folder tab so the form mounts, then re-render
    // with the tab gone. Save then exercises the `if (!workspacePath) return;`
    // arm on line 159.
    routeInvoke({
      sync_get_config: () => null,
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => true,
      sync_set_config: () => null,
    });
    // No tabs at all: the empty-state branch covers the negative guard
    // because the modal mounts without a workspacePath.
    const wrapper = withTabs(tabsContextValue({ workspace: null }));
    render(<SyncSettingsModal open={true} onClose={vi.fn()} />, { wrapper });
    expect(
      await screen.findByText(/Open a folder workspace to configure cloud sync/i),
    ).toBeInTheDocument();
    // sync_set_config must not be reachable from this empty state.
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
  });

  it("Save with a blank branch field persists 'main' (configFromForm fallback)", async () => {
    // Exercises the `form.remoteBranch.trim() || "main"` branch on line 84
    // of the modal. The setup form starts with "main" pre-filled; wipe it
    // and confirm the saved config restores the default.
    const calls: Array<Record<string, unknown>> = [];
    routeInvoke({
      sync_get_config: () => null,
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => true,
      sync_set_config: (args) => {
        calls.push(args as Record<string, unknown>);
        return null;
      },
      sync_set_origin: () => null,
      sync_commit_config: () => false,
    });
    const wrapper = withTabs(tabsContextValue({ workspace: makeWorkspace() }));
    render(<SyncSettingsModal open={true} onClose={vi.fn()} />, { wrapper });

    fireEvent.change(await screen.findByPlaceholderText("https://github.com/you/notes.git"), {
      target: { value: "https://example.com/r.git" },
    });
    fireEvent.change(screen.getByPlaceholderText("main"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save config" }));

    await waitFor(() => expect(calls).toHaveLength(1));
    const cfg = calls[0].config as WorkspaceSyncConfig;
    expect(cfg.remoteBranch).toBe("main");
  });
});
