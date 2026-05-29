import { invoke } from "@tauri-apps/api/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TabsContext, type TabsContextValue } from "@/contexts/TabsContext";
import type { FolderTab } from "@/hooks/useTabs";
import type { WorkspaceSyncConfig } from "@/lib/sync";
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

function folderTab(root = "/w"): FolderTab {
  return {
    id: "tab-1",
    kind: "folder",
    root,
    expanded: new Set<string>(),
    nodes: new Map(),
    file: null,
  };
}

function tabsValue(activeTab: FolderTab | null): TabsContextValue {
  return {
    tabs: activeTab ? [activeTab] : [],
    activeTab,
    activeTabId: activeTab?.id ?? null,
    activeFile: null,
    initializing: false,
    workspaceFiles: [],
    wikilinkRefs: [],
    openFile: vi.fn(),
    openFolder: vi.fn(),
    openFileInFolderTab: vi.fn(),
    toggleExpand: vi.fn(),
    closeTab: vi.fn(),
    setActiveTab: vi.fn(),
    setTabMode: vi.fn(),
    updateEditContent: vi.fn(),
    markSaved: vi.fn(),
    toggleTask: vi.fn(),
    saveScrollPosition: vi.fn(),
    openFileDialog: vi.fn(),
    undoEdit: vi.fn(),
    redoEdit: vi.fn(),
    displayContent: null,
    tocEntries: [],
    backlinks: [],
  };
}

function withTabs(value: TabsContextValue) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TabsContext.Provider value={value}>{children}</TabsContext.Provider>
  );
  return wrapper;
}

describe("SyncSettingsModal", () => {
  it("renders nothing when closed", async () => {
    const wrapper = withTabs(tabsValue(folderTab()));
    const { container } = render(<SyncSettingsModal open={false} onClose={vi.fn()} />, {
      wrapper,
    });
    expect(container.querySelector(".settings-overlay")).toBeNull();
    // Flush the async config-load microtask so its setState lands inside
    // act and React doesn't warn after the test returns.
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("sync_get_config", expect.anything()));
  });

  it("shows the empty-state hint when no folder workspace is open", async () => {
    const wrapper = withTabs(tabsValue(null));
    render(<SyncSettingsModal open={true} onClose={vi.fn()} />, { wrapper });
    expect(
      await screen.findByText(/Open a folder workspace to configure cloud sync/i),
    ).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("renders the setup form prefilled with defaults for an unconfigured workspace", async () => {
    routeInvoke({ sync_get_config: () => null });
    const wrapper = withTabs(tabsValue(folderTab()));
    render(<SyncSettingsModal open={true} onClose={vi.fn()} />, { wrapper });

    expect(await screen.findByText("Cloud Sync")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
    const branch = screen.getByPlaceholderText("main") as HTMLInputElement;
    expect(branch.value).toBe("main");
    expect(screen.getByRole("button", { name: "Save config" })).toBeDisabled();
    // The "Sync now"/"Disable" actions are configured-only.
    expect(screen.queryByRole("button", { name: /Sync now/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Disable sync/ })).toBeNull();
  });

  it("shows configured actions when a config is already stored", async () => {
    const stored: WorkspaceSyncConfig = {
      workspacePath: "/w",
      backend: "git",
      remoteUrl: "https://example.com/r.git",
      remoteBranch: "develop",
      conflictPolicy: "prefer-remote",
      autoSyncSeconds: 300,
      author: { name: "A", email: "a@example.com" },
    };
    routeInvoke({ sync_get_config: () => stored });
    const wrapper = withTabs(tabsValue(folderTab()));
    render(<SyncSettingsModal open={true} onClose={vi.fn()} />, { wrapper });

    expect(await screen.findByRole("button", { name: "Save changes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync now" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disable sync" })).toBeInTheDocument();
    const remote = screen.getByPlaceholderText(
      "https://github.com/you/notes.git",
    ) as HTMLInputElement;
    await waitFor(() => expect(remote.value).toBe("https://example.com/r.git"));
  });

  it("typing into Remote URL enables Save config", async () => {
    routeInvoke({ sync_get_config: () => null });
    const wrapper = withTabs(tabsValue(folderTab()));
    render(<SyncSettingsModal open={true} onClose={vi.fn()} />, { wrapper });

    const save = await screen.findByRole("button", { name: "Save config" });
    expect(save).toBeDisabled();

    const remote = screen.getByPlaceholderText("https://github.com/you/notes.git");
    fireEvent.change(remote, { target: { value: "https://github.com/me/n.git" } });
    expect(save).not.toBeDisabled();
  });

  it("Escape closes the modal", async () => {
    routeInvoke({ sync_get_config: () => null });
    const onClose = vi.fn();
    const wrapper = withTabs(tabsValue(folderTab()));
    render(<SyncSettingsModal open={true} onClose={onClose} />, { wrapper });
    await screen.findByText("Cloud Sync");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the Initialize banner when the workspace isn't a git repo yet", async () => {
    routeInvoke({
      sync_get_config: () => null,
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => false,
    });
    const wrapper = withTabs(tabsValue(folderTab()));
    render(<SyncSettingsModal open={true} onClose={vi.fn()} />, { wrapper });

    expect(await screen.findByTestId("sync-init-banner")).toHaveTextContent(
      /isn't a git repository yet/i,
    );
    expect(screen.getByRole("button", { name: "Initialize repo" })).toBeInTheDocument();
  });

  it("clicking Initialize calls sync_init_repo and hides the banner", async () => {
    let probeCount = 0;
    routeInvoke({
      sync_get_config: () => null,
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => {
        probeCount += 1;
        return probeCount !== 1;
      },
      sync_init_repo: () => null,
    });
    const wrapper = withTabs(tabsValue(folderTab()));
    render(<SyncSettingsModal open={true} onClose={vi.fn()} />, { wrapper });

    const initBtn = await screen.findByRole("button", { name: "Initialize repo" });
    fireEvent.click(initBtn);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("sync_init_repo", expect.anything()));
    await waitFor(() => expect(screen.queryByTestId("sync-init-banner")).toBeNull());
  });

  it("commit message field is empty by default and passes through to runSync", async () => {
    const stored: WorkspaceSyncConfig = {
      workspacePath: "/w",
      backend: "git",
      remoteUrl: "https://example.com/r.git",
      remoteBranch: "main",
      conflictPolicy: "prompt",
      autoSyncSeconds: null,
      author: null,
    };
    routeInvoke({
      sync_get_config: () => stored,
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => true,
      sync_run: () => ({
        kind: "git",
        pulledCount: 0,
        committedCount: 1,
        pushedCount: 1,
        conflicts: [],
        completedUnix: 1000,
      }),
      sync_status: () => ({
        kind: "git",
        clean: true,
        ahead: 0,
        behind: 0,
        conflicts: [],
        lastSyncUnix: null,
      }),
    });
    const wrapper = withTabs(tabsValue(folderTab()));
    render(<SyncSettingsModal open={true} onClose={vi.fn()} />, { wrapper });

    const msgInput = (await screen.findByPlaceholderText("e.g. Update notes")) as HTMLInputElement;
    expect(msgInput.value).toBe("");

    fireEvent.change(msgInput, { target: { value: "fix readme" } });
    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("sync_run", {
        workspacePath: "/w",
        message: "fix readme",
      }),
    );
    // Cleared after the run, ready for the next sync.
    await waitFor(() => expect(msgInput.value).toBe(""));
  });

  it("uses the git-config author name as the Author placeholder", async () => {
    routeInvoke({
      sync_get_config: () => null,
      sync_default_author: () => ({ name: "Hamid", email: "h@example.com" }),
      sync_repo_present: () => true,
    });
    const wrapper = withTabs(tabsValue(folderTab()));
    render(<SyncSettingsModal open={true} onClose={vi.fn()} />, { wrapper });

    const nameInput = (await screen.findByPlaceholderText("Hamid")) as HTMLInputElement;
    expect(nameInput.value).toBe("");
    const emailInput = screen.getByPlaceholderText("h@example.com") as HTMLInputElement;
    expect(emailInput.value).toBe("");
  });

  it("Initialize forwards the form's branch and remote URL to sync_init_repo", async () => {
    let probeCount = 0;
    let initArgs: unknown = null;
    routeInvoke({
      sync_get_config: () => null,
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => {
        probeCount += 1;
        return probeCount !== 1;
      },
      sync_init_repo: (args) => {
        initArgs = args;
        return null;
      },
    });
    const wrapper = withTabs(tabsValue(folderTab()));
    render(<SyncSettingsModal open={true} onClose={vi.fn()} />, { wrapper });

    await screen.findByTestId("sync-init-banner");
    fireEvent.change(screen.getByPlaceholderText("https://github.com/you/notes.git"), {
      target: { value: "https://example.com/me.git" },
    });
    fireEvent.change(screen.getByPlaceholderText("main"), { target: { value: "trunk" } });
    fireEvent.click(screen.getByRole("button", { name: "Initialize repo" }));

    await waitFor(() =>
      expect(initArgs).toEqual({
        workspacePath: "/w",
        defaultBranch: "trunk",
        remoteUrl: "https://example.com/me.git",
      }),
    );
    await waitFor(() => expect(screen.queryByTestId("sync-init-banner")).toBeNull());
  });

  it("Sync now renders the lastSync block with pulled/committed/pushed counts", async () => {
    const stored: WorkspaceSyncConfig = {
      workspacePath: "/w",
      backend: "git",
      remoteUrl: "https://example.com/r.git",
      remoteBranch: "main",
      conflictPolicy: "prompt",
      autoSyncSeconds: null,
      author: null,
    };
    routeInvoke({
      sync_get_config: () => stored,
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => true,
      sync_run: () => ({
        kind: "git",
        pulledCount: 4,
        committedCount: 2,
        pushedCount: 1,
        conflicts: [],
        completedUnix: 5000,
      }),
      sync_status: () => ({
        kind: "git",
        clean: true,
        ahead: 0,
        behind: 0,
        conflicts: [],
        lastSyncUnix: null,
      }),
    });
    const wrapper = withTabs(tabsValue(folderTab()));
    render(<SyncSettingsModal open={true} onClose={vi.fn()} />, { wrapper });

    fireEvent.click(await screen.findByRole("button", { name: "Sync now" }));
    const block = await screen.findByTestId("sync-status");
    await waitFor(() => expect(block.textContent).toMatch(/pulled/));
    expect(block.textContent).toMatch(/pulled/);
    expect(block.textContent).toMatch(/2/);
    expect(block.textContent).toMatch(/1/);
  });

  it("Sync now appends a conflict suffix to the lastSync block when conflicts come back", async () => {
    const stored: WorkspaceSyncConfig = {
      workspacePath: "/w",
      backend: "git",
      remoteUrl: "https://example.com/r.git",
      remoteBranch: "main",
      conflictPolicy: "prompt",
      autoSyncSeconds: null,
      author: null,
    };
    routeInvoke({
      sync_get_config: () => stored,
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => true,
      sync_run: () => ({
        kind: "git",
        pulledCount: 0,
        committedCount: 1,
        pushedCount: 0,
        conflicts: ["notes.md", "todo.md"],
        completedUnix: 5000,
      }),
      sync_status: () => ({
        kind: "git",
        clean: true,
        ahead: 0,
        behind: 0,
        conflicts: [],
        lastSyncUnix: null,
      }),
    });
    const wrapper = withTabs(tabsValue(folderTab()));
    render(<SyncSettingsModal open={true} onClose={vi.fn()} />, { wrapper });

    fireEvent.click(await screen.findByRole("button", { name: "Sync now" }));
    const block = await screen.findByTestId("sync-status");
    await waitFor(() => expect(block.textContent).toMatch(/2 conflict\(s\) need attention/));
  });

  it("Refresh status renders the clean/ahead/behind block", async () => {
    const stored: WorkspaceSyncConfig = {
      workspacePath: "/w",
      backend: "git",
      remoteUrl: "https://example.com/r.git",
      remoteBranch: "main",
      conflictPolicy: "prompt",
      autoSyncSeconds: null,
      author: null,
    };
    routeInvoke({
      sync_get_config: () => stored,
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => true,
      sync_status: () => ({
        kind: "git",
        clean: true,
        ahead: 2,
        behind: 3,
        conflicts: [],
        lastSyncUnix: null,
      }),
    });
    const wrapper = withTabs(tabsValue(folderTab()));
    render(<SyncSettingsModal open={true} onClose={vi.fn()} />, { wrapper });

    fireEvent.click(await screen.findByRole("button", { name: "Refresh status" }));
    const block = await screen.findByTestId("sync-status");
    await waitFor(() => expect(block.textContent).toMatch(/Ahead:/));
    expect(block.textContent).toMatch(/clean/);
    expect(block.textContent).toMatch(/2/);
    expect(block.textContent).toMatch(/3/);
  });

  it("Refresh status renders an unresolved-conflicts banner when conflicts are present", async () => {
    const stored: WorkspaceSyncConfig = {
      workspacePath: "/w",
      backend: "git",
      remoteUrl: "https://example.com/r.git",
      remoteBranch: "main",
      conflictPolicy: "prompt",
      autoSyncSeconds: null,
      author: null,
    };
    routeInvoke({
      sync_get_config: () => stored,
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => true,
      sync_status: () => ({
        kind: "git",
        clean: false,
        ahead: 0,
        behind: 0,
        conflicts: ["a.md", "b.md"],
        lastSyncUnix: null,
      }),
    });
    const wrapper = withTabs(tabsValue(folderTab()));
    render(<SyncSettingsModal open={true} onClose={vi.fn()} />, { wrapper });

    fireEvent.click(await screen.findByRole("button", { name: "Refresh status" }));
    const block = await screen.findByTestId("sync-status");
    await waitFor(() => expect(block.textContent).toMatch(/Unresolved conflicts: a\.md, b\.md/));
  });

  it("Disable sync calls sync_remove_config and switches the modal back to the unconfigured form", async () => {
    const stored: WorkspaceSyncConfig = {
      workspacePath: "/w",
      backend: "git",
      remoteUrl: "https://example.com/r.git",
      remoteBranch: "main",
      conflictPolicy: "prompt",
      autoSyncSeconds: null,
      author: null,
    };
    routeInvoke({
      sync_get_config: () => stored,
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => true,
      sync_remove_config: () => null,
    });
    const wrapper = withTabs(tabsValue(folderTab()));
    render(<SyncSettingsModal open={true} onClose={vi.fn()} />, { wrapper });

    fireEvent.click(await screen.findByRole("button", { name: "Disable sync" }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("sync_remove_config", { workspacePath: "/w" }),
    );
    await waitFor(() => expect(screen.queryByRole("button", { name: "Disable sync" })).toBeNull());
    expect(screen.getByRole("button", { name: "Save config" })).toBeInTheDocument();
  });

  it("Conflict policy segmented control updates data-active per option", async () => {
    routeInvoke({
      sync_get_config: () => null,
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => true,
      sync_set_config: () => null,
    });
    const wrapper = withTabs(tabsValue(folderTab()));
    render(<SyncSettingsModal open={true} onClose={vi.fn()} />, { wrapper });

    const promptBtn = await screen.findByRole("button", { name: "Prompt me" });
    const remoteBtn = screen.getByRole("button", { name: "Take remote" });
    const localBtn = screen.getByRole("button", { name: "Keep local" });

    // Default: "prompt" is selected.
    expect(promptBtn).toHaveAttribute("data-active", "true");
    expect(remoteBtn).toHaveAttribute("data-active", "false");
    expect(localBtn).toHaveAttribute("data-active", "false");

    fireEvent.click(remoteBtn);
    expect(remoteBtn).toHaveAttribute("data-active", "true");
    expect(promptBtn).toHaveAttribute("data-active", "false");

    fireEvent.click(localBtn);
    expect(localBtn).toHaveAttribute("data-active", "true");

    // Save uses the latest chosen policy.
    fireEvent.change(screen.getByPlaceholderText("https://github.com/you/notes.git"), {
      target: { value: "https://example.com/r.git" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save config" }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "sync_set_config",
        expect.objectContaining({
          config: expect.objectContaining({ conflictPolicy: "prefer-local" }),
        }),
      ),
    );
  });

  it("Save with a non-empty token calls sync_set_token after sync_set_config and clears the field", async () => {
    routeInvoke({
      sync_get_config: () => null,
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => false,
      sync_set_config: () => null,
      sync_set_token: () => null,
    });
    const wrapper = withTabs(tabsValue(folderTab()));
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
    });
    const wrapper = withTabs(tabsValue(folderTab()));
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

  it("backdrop click closes the modal", async () => {
    routeInvoke({
      sync_get_config: () => null,
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => true,
    });
    const onClose = vi.fn();
    const wrapper = withTabs(tabsValue(folderTab()));
    const { container } = render(<SyncSettingsModal open={true} onClose={onClose} />, { wrapper });
    await screen.findByText("Cloud Sync");

    const overlay = container.querySelector(".settings-overlay") as HTMLElement;
    expect(overlay).not.toBeNull();
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalled();
  });

  it("surfaces sync errors under the form when runSync rejects", async () => {
    const stored: WorkspaceSyncConfig = {
      workspacePath: "/w",
      backend: "git",
      remoteUrl: "https://example.com/r.git",
      remoteBranch: "main",
      conflictPolicy: "prompt",
      autoSyncSeconds: null,
      author: null,
    };
    routeInvoke({
      sync_get_config: () => stored,
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => true,
      sync_run: () => {
        throw { kind: "auth-failed", message: "bad token" };
      },
    });
    const wrapper = withTabs(tabsValue(folderTab()));
    render(<SyncSettingsModal open={true} onClose={vi.fn()} />, { wrapper });

    fireEvent.click(await screen.findByRole("button", { name: "Sync now" }));
    expect(await screen.findByText(/Authentication failed: bad token/)).toBeInTheDocument();
  });

  it("autoSyncSeconds: positive integers are persisted as-is", async () => {
    const calls: Array<Record<string, unknown>> = [];
    routeInvoke({
      sync_get_config: () => null,
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => true,
      sync_set_config: (args) => {
        calls.push(args as Record<string, unknown>);
        return null;
      },
    });
    const wrapper = withTabs(tabsValue(folderTab()));
    render(<SyncSettingsModal open={true} onClose={vi.fn()} />, { wrapper });

    const remote = await screen.findByPlaceholderText("https://github.com/you/notes.git");
    fireEvent.change(remote, { target: { value: "https://example.com/r.git" } });
    fireEvent.change(screen.getByPlaceholderText("off"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save config" }));

    await waitFor(() => expect(calls).toHaveLength(1));
    const cfg = calls[0].config as WorkspaceSyncConfig;
    expect(cfg.autoSyncSeconds).toBe(30);
  });

  it("autoSyncSeconds: 0, negative, and blank all collapse to null", async () => {
    // Cases are independent renders so the React effect that syncs form
    // state from the persisted config never overwrites a fresh edit
    // mid-test.
    for (const raw of ["0", "-5", ""]) {
      const calls: Array<Record<string, unknown>> = [];
      routeInvoke({
        sync_get_config: () => null,
        sync_default_author: () => ({ name: null, email: null }),
        sync_repo_present: () => true,
        sync_set_config: (args) => {
          calls.push(args as Record<string, unknown>);
          return null;
        },
      });
      const wrapper = withTabs(tabsValue(folderTab()));
      const { unmount } = render(<SyncSettingsModal open={true} onClose={vi.fn()} />, {
        wrapper,
      });

      const remote = await screen.findByPlaceholderText("https://github.com/you/notes.git");
      fireEvent.change(remote, { target: { value: "https://example.com/r.git" } });
      fireEvent.change(screen.getByPlaceholderText("off"), { target: { value: raw } });
      fireEvent.click(screen.getByRole("button", { name: "Save config" }));

      await waitFor(() => expect(calls).toHaveLength(1));
      const cfg = calls[0].config as WorkspaceSyncConfig;
      expect(cfg.autoSyncSeconds).toBeNull();
      unmount();
    }
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
    });
    const wrapper = withTabs(tabsValue(folderTab()));
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
    });
    const wrapper = withTabs(tabsValue(folderTab()));
    render(<SyncSettingsModal open={true} onClose={vi.fn()} />, { wrapper });

    fireEvent.change(await screen.findByPlaceholderText("https://github.com/you/notes.git"), {
      target: { value: "https://example.com/r.git" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save config" }));

    await waitFor(() => expect(calls).toHaveLength(1));
    const cfg = calls[0].config as WorkspaceSyncConfig;
    expect(cfg.author).toBeNull();
  });
});
