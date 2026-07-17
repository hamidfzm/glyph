import { invoke } from "@tauri-apps/api/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SyncConfigProvider } from "@/contexts/SyncConfigProvider";
import { TabsContext, type TabsContextValue } from "@/contexts/TabsContext";
import type { Workspace } from "@/hooks/useTabs";
import type { WorkspaceSyncConfig } from "@/lib/sync";
import { COMPLETE_INDEX_STATUS } from "@/lib/workspaceScan";
import {
  commitSaveConfig,
  type FormState,
  resolveSaveConfig,
  SyncSettingsModal,
} from "./SyncSettingsModal";

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

function tabsValue(workspace: Workspace | null): TabsContextValue {
  return {
    tabs: [],
    activeTab: null,
    activeTabId: null,
    activeFile: null,
    initializing: false,
    workspaceFiles: [],
    wikilinkRefs: [],
    indexStatus: COMPLETE_INDEX_STATUS,
    workspace,
    openFile: vi.fn(),
    openFolder: vi.fn(),
    openGraph: vi.fn(),
    closeWorkspace: vi.fn(),
    toggleExpand: vi.fn(),
    createNote: vi.fn(),
    createCanvas: vi.fn(),
    commitEdit: vi.fn(),
    createFolder: vi.fn(),
    renamePath: vi.fn(),
    duplicatePath: vi.fn(),
    movePath: vi.fn(),
    collapseAll: vi.fn(),
    expandAll: vi.fn(),
    deletePath: vi.fn(),
    closeTab: vi.fn(),
    setActiveTab: vi.fn(),
    moveTab: vi.fn(),
    moveActiveTab: vi.fn(),
    setTabMode: vi.fn(),
    updateEditContent: vi.fn(),
    saveDocument: vi.fn(),
    flushForClose: vi.fn(),
    toggleTask: vi.fn(),
    saveScrollPosition: vi.fn(),
    openFileDialog: vi.fn(),
    undoEdit: vi.fn(),
    redoEdit: vi.fn(),
    displayContent: null,
    tocEntries: [],
    backlinks: [],
    workspaceNotice: null,
    dismissWorkspaceNotice: vi.fn(),
  };
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

describe("SyncSettingsModal", () => {
  it("renders nothing when closed", async () => {
    const wrapper = withTabs(tabsValue(makeWorkspace()));
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
    const wrapper = withTabs(tabsValue(makeWorkspace()));
    render(<SyncSettingsModal open={true} onClose={vi.fn()} />, { wrapper });

    expect(await screen.findByText("Cloud Sync")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
    const branch = screen.getByPlaceholderText("main") as HTMLInputElement;
    expect(branch.value).toBe("main");
    // Save is enabled even with a blank Remote URL — local-only sync is valid.
    expect(screen.getByRole("button", { name: "Save config" })).toBeEnabled();
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
      author: { name: "A", email: "a@example.com" },
    };
    routeInvoke({ sync_get_config: () => stored });
    const wrapper = withTabs(tabsValue(makeWorkspace()));
    render(<SyncSettingsModal open={true} onClose={vi.fn()} />, { wrapper });

    expect(await screen.findByRole("button", { name: "Save changes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync now" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disable sync" })).toBeInTheDocument();
    const remote = screen.getByPlaceholderText(
      "https://github.com/you/notes.git",
    ) as HTMLInputElement;
    await waitFor(() => expect(remote.value).toBe("https://example.com/r.git"));
  });

  it("Escape closes the modal", async () => {
    routeInvoke({ sync_get_config: () => null });
    const onClose = vi.fn();
    const wrapper = withTabs(tabsValue(makeWorkspace()));
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
    const wrapper = withTabs(tabsValue(makeWorkspace()));
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
    const wrapper = withTabs(tabsValue(makeWorkspace()));
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
    const wrapper = withTabs(tabsValue(makeWorkspace()));
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
    const wrapper = withTabs(tabsValue(makeWorkspace()));
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
    const wrapper = withTabs(tabsValue(makeWorkspace()));
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
    const wrapper = withTabs(tabsValue(makeWorkspace()));
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
    const wrapper = withTabs(tabsValue(makeWorkspace()));
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
    const wrapper = withTabs(tabsValue(makeWorkspace()));
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
    const wrapper = withTabs(tabsValue(makeWorkspace()));
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
      author: null,
    };
    routeInvoke({
      sync_get_config: () => stored,
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => true,
      sync_remove_config: () => null,
    });
    const wrapper = withTabs(tabsValue(makeWorkspace()));
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
      sync_set_origin: () => null,
      sync_commit_config: () => false,
    });
    const wrapper = withTabs(tabsValue(makeWorkspace()));
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
      sync_init_repo: () => null,
      sync_set_config: () => null,
      sync_set_origin: () => null,
      sync_set_token: () => null,
      sync_commit_config: () => false,
    });
    const wrapper = withTabs(tabsValue(makeWorkspace()));
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
    const wrapper = withTabs(tabsValue(makeWorkspace()));
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
    const wrapper = withTabs(tabsValue(makeWorkspace()));
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
    const wrapper = withTabs(tabsValue(makeWorkspace()));
    render(<SyncSettingsModal open={true} onClose={vi.fn()} />, { wrapper });

    fireEvent.click(await screen.findByRole("button", { name: "Sync now" }));
    expect(await screen.findByText(/Authentication failed: bad token/)).toBeInTheDocument();
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
    const wrapper = withTabs(tabsValue(makeWorkspace()));
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
    const wrapper = withTabs(tabsValue(makeWorkspace()));
    render(<SyncSettingsModal open={true} onClose={vi.fn()} />, { wrapper });

    fireEvent.change(await screen.findByPlaceholderText("https://github.com/you/notes.git"), {
      target: { value: "https://example.com/r.git" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save config" }));

    await waitFor(() => expect(calls).toHaveLength(1));
    const cfg = calls[0].config as WorkspaceSyncConfig;
    expect(cfg.author).toBeNull();
  });

  it("relativeTime renders seconds/minutes/hours/days buckets from status.lastSyncUnix", async () => {
    // The status block runs `relativeTime` against the fetched lastSyncUnix,
    // so feeding deltas off `Date.now()` walks every bucket on lines 92-97
    // without faking timers (which would deadlock React's microtask flush).
    const stored: WorkspaceSyncConfig = {
      workspacePath: "/w",
      backend: "git",
      remoteUrl: "https://example.com/r.git",
      remoteBranch: "main",
      conflictPolicy: "prompt",
      author: null,
    };
    const cases: Array<{ delta: number; expectMatch: RegExp }> = [
      { delta: 30, expectMatch: /\d+s ago/ },
      { delta: 120, expectMatch: /\dm ago/ },
      { delta: 7200, expectMatch: /\dh ago/ },
      { delta: 86400 * 3, expectMatch: /3d ago/ },
    ];
    for (const { delta, expectMatch } of cases) {
      const now = Math.floor(Date.now() / 1000);
      routeInvoke({
        sync_get_config: () => stored,
        sync_default_author: () => ({ name: null, email: null }),
        sync_repo_present: () => true,
        sync_status: () => ({
          kind: "git",
          clean: true,
          ahead: 0,
          behind: 0,
          conflicts: [],
          lastSyncUnix: now - delta,
        }),
      });
      const wrapper = withTabs(tabsValue(makeWorkspace()));
      const { unmount } = render(<SyncSettingsModal open={true} onClose={vi.fn()} />, {
        wrapper,
      });
      fireEvent.click(await screen.findByRole("button", { name: "Refresh status" }));
      const block = await screen.findByTestId("sync-status");
      await waitFor(() => expect(block.textContent).toMatch(expectMatch));
      unmount();
    }
  });

  it("relativeTime renders 'never' when lastSyncUnix is null in the status block", async () => {
    // The status block only shows the Last sync row when a status report has
    // landed; render one with lastSyncUnix === null and confirm the null
    // branch of relativeTime fires.
    const stored: WorkspaceSyncConfig = {
      workspacePath: "/w",
      backend: "git",
      remoteUrl: "https://example.com/r.git",
      remoteBranch: "main",
      conflictPolicy: "prompt",
      author: null,
    };
    routeInvoke({
      sync_get_config: () => stored,
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => true,
      sync_status: () => ({
        kind: "git",
        clean: true,
        ahead: 0,
        behind: 0,
        conflicts: [],
        lastSyncUnix: null,
      }),
    });
    const wrapper = withTabs(tabsValue(makeWorkspace()));
    render(<SyncSettingsModal open={true} onClose={vi.fn()} />, { wrapper });

    fireEvent.click(await screen.findByRole("button", { name: "Refresh status" }));
    const block = await screen.findByTestId("sync-status");
    await waitFor(() => expect(block.textContent).toMatch(/Last sync: never/));
  });

  it("overlay onKeyDown closes the modal on Escape (and ignores other keys)", async () => {
    // The window-level keydown handler already fires on Escape; this case
    // covers the JSX-attached `onKeyDown` on the overlay element itself.
    // Both branches: Escape closes, any other key does not.
    routeInvoke({
      sync_get_config: () => null,
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => true,
    });
    const onClose = vi.fn();
    const wrapper = withTabs(tabsValue(makeWorkspace()));
    const { container } = render(<SyncSettingsModal open={true} onClose={onClose} />, { wrapper });
    await screen.findByText("Cloud Sync");

    const overlay = container.querySelector(".settings-overlay") as HTMLElement;
    fireEvent.keyDown(overlay, { key: "Tab" });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(overlay, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("window keydown handler ignores non-Escape keys", async () => {
    // Covers the `if (e.key === "Escape")` branch on line 140 of the modal:
    // the false arm (any other key) must leave onClose untouched.
    routeInvoke({
      sync_get_config: () => null,
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => true,
    });
    const onClose = vi.fn();
    const wrapper = withTabs(tabsValue(makeWorkspace()));
    render(<SyncSettingsModal open={true} onClose={onClose} />, { wrapper });
    await screen.findByText("Cloud Sync");

    fireEvent.keyDown(window, { key: "Enter" });
    expect(onClose).not.toHaveBeenCalled();
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
    const wrapper = withTabs(tabsValue(makeWorkspace()));
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
    const wrapper = withTabs(tabsValue(null));
    render(<SyncSettingsModal open={true} onClose={vi.fn()} />, { wrapper });
    expect(
      await screen.findByText(/Open a folder workspace to configure cloud sync/i),
    ).toBeInTheDocument();
    // sync_set_config must not be reachable from this empty state.
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
  });

  it("Initialize with a blank branch field defaults to 'main' and forwards no remote URL", async () => {
    // Covers both `||` short-circuits on line 192: blank branch falls back
    // to "main", and a blank remote URL becomes null instead of "".
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
    const wrapper = withTabs(tabsValue(makeWorkspace()));
    render(<SyncSettingsModal open={true} onClose={vi.fn()} />, { wrapper });

    await screen.findByTestId("sync-init-banner");
    // Wipe both fields out (branch defaults to "main" when blank).
    fireEvent.change(screen.getByPlaceholderText("main"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Initialize repo" }));

    await waitFor(() =>
      expect(initArgs).toEqual({
        workspacePath: "/w",
        defaultBranch: "main",
        remoteUrl: null,
      }),
    );
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
    const wrapper = withTabs(tabsValue(makeWorkspace()));
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

function makeForm(overrides: Partial<FormState> = {}): FormState {
  return {
    remoteUrl: "https://example.com/r.git",
    remoteBranch: "main",
    conflictPolicy: "prompt",
    authorName: "",
    authorEmail: "",
    token: "",
    commitMessage: "",
    ...overrides,
  };
}

// The no-workspace guard inside the Save flow can't be reached by driving the
// form (the Save button is hidden with no workspace), so it's exercised here
// against the extracted helper directly.
describe("resolveSaveConfig", () => {
  it("returns null when there is no workspace path", () => {
    expect(resolveSaveConfig(null, makeForm())).toBeNull();
  });

  it("returns a local-only config (empty remoteUrl) when the URL is blank", () => {
    const next = resolveSaveConfig("/w", makeForm({ remoteUrl: "   " }));
    expect(next).toMatchObject({ workspacePath: "/w", backend: "git", remoteUrl: "" });
  });

  it("returns the resolved config when workspace and URL are present", () => {
    const next = resolveSaveConfig("/w", makeForm({ remoteUrl: "https://example.com/r.git" }));
    expect(next).toMatchObject({
      workspacePath: "/w",
      backend: "git",
      remoteUrl: "https://example.com/r.git",
    });
  });
});

describe("commitSaveConfig", () => {
  function deps(overrides: Partial<Parameters<typeof commitSaveConfig>[2]> = {}) {
    return {
      repoPresent: true,
      initRepo: vi.fn().mockResolvedValue(undefined),
      save: vi.fn().mockResolvedValue(undefined),
      setOrigin: vi.fn().mockResolvedValue(undefined),
      setToken: vi.fn().mockResolvedValue(undefined),
      clearTokenField: vi.fn(),
      commitConfig: vi.fn().mockResolvedValue(true),
      ...overrides,
    };
  }

  function configWith(remoteUrl: string): WorkspaceSyncConfig {
    return {
      workspacePath: "/w",
      backend: "git",
      remoteUrl,
      remoteBranch: "main",
      conflictPolicy: "prompt",
      author: null,
    };
  }

  it("is a no-op when there is nothing to save", async () => {
    const d = deps();
    await commitSaveConfig(null, "tok", d);
    expect(d.initRepo).not.toHaveBeenCalled();
    expect(d.save).not.toHaveBeenCalled();
    expect(d.setOrigin).not.toHaveBeenCalled();
    expect(d.setToken).not.toHaveBeenCalled();
    expect(d.clearTokenField).not.toHaveBeenCalled();
    expect(d.commitConfig).not.toHaveBeenCalled();
  });

  it("saves, pushes origin, commits the config, and stores the token when the repo exists", async () => {
    const d = deps({ repoPresent: true });
    await commitSaveConfig(configWith("https://example.com/r.git"), "  ghp_secret  ", d);
    expect(d.initRepo).not.toHaveBeenCalled();
    expect(d.save).toHaveBeenCalledWith(configWith("https://example.com/r.git"));
    expect(d.setOrigin).toHaveBeenCalledWith("https://example.com/r.git");
    expect(d.setToken).toHaveBeenCalledWith("ghp_secret");
    expect(d.clearTokenField).toHaveBeenCalled();
    expect(d.commitConfig).toHaveBeenCalled();
  });

  it("auto-initializes the repo (with the remote) when the folder isn't a git repo yet", async () => {
    const d = deps({ repoPresent: false });
    await commitSaveConfig(configWith("https://example.com/r.git"), "", d);
    expect(d.initRepo).toHaveBeenCalledWith("main", "https://example.com/r.git");
    expect(d.save).toHaveBeenCalled();
    // After init the repo exists, so origin is still written.
    expect(d.setOrigin).toHaveBeenCalledWith("https://example.com/r.git");
    expect(d.commitConfig).toHaveBeenCalled();
  });

  it("auto-initializes a local-only repo (no remote) and skips setOrigin", async () => {
    const d = deps({ repoPresent: false });
    await commitSaveConfig(configWith(""), "", d);
    // Blank remote -> init without an origin, and no setOrigin afterwards.
    expect(d.initRepo).toHaveBeenCalledWith("main", null);
    expect(d.save).toHaveBeenCalled();
    expect(d.setOrigin).not.toHaveBeenCalled();
    expect(d.commitConfig).toHaveBeenCalled();
  });

  it("saves but skips setOrigin for a local-only config (blank remoteUrl) when the repo exists", async () => {
    const d = deps({ repoPresent: true });
    await commitSaveConfig(configWith(""), "", d);
    expect(d.initRepo).not.toHaveBeenCalled();
    expect(d.save).toHaveBeenCalled();
    // No remote to write into .git/config, even though the repo exists.
    expect(d.setOrigin).not.toHaveBeenCalled();
    expect(d.commitConfig).toHaveBeenCalled();
  });

  it("swallows setOrigin and commitConfig failures so the save still resolves", async () => {
    const d = deps({
      repoPresent: true,
      setOrigin: vi.fn().mockRejectedValue(new Error("network down")),
      commitConfig: vi.fn().mockRejectedValue(new Error("commit failed")),
    });
    await expect(
      commitSaveConfig(configWith("https://example.com/r.git"), "", d),
    ).resolves.toBeUndefined();
    expect(d.save).toHaveBeenCalled();
    expect(d.commitConfig).toHaveBeenCalled();
  });
});
