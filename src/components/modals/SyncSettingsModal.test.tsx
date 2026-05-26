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
});
