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

describe("SyncSettingsModal rendering", () => {
  it("renders nothing when closed", async () => {
    const wrapper = withTabs(tabsContextValue({ workspace: makeWorkspace() }));
    const { container } = render(<SyncSettingsModal open={false} onClose={vi.fn()} />, {
      wrapper,
    });
    expect(container.querySelector(".settings-overlay")).toBeNull();
    // Flush the async config-load microtask so its setState lands inside
    // act and React doesn't warn after the test returns.
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("sync_get_config", expect.anything()));
  });

  it("shows the empty-state hint when no folder workspace is open", async () => {
    const wrapper = withTabs(tabsContextValue({ workspace: null }));
    render(<SyncSettingsModal open={true} onClose={vi.fn()} />, { wrapper });
    expect(
      await screen.findByText(/Open a folder workspace to configure cloud sync/i),
    ).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("renders the setup form prefilled with defaults for an unconfigured workspace", async () => {
    routeInvoke({ sync_get_config: () => null });
    const wrapper = withTabs(tabsContextValue({ workspace: makeWorkspace() }));
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
    const wrapper = withTabs(tabsContextValue({ workspace: makeWorkspace() }));
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
    const wrapper = withTabs(tabsContextValue({ workspace: makeWorkspace() }));
    render(<SyncSettingsModal open={true} onClose={onClose} />, { wrapper });
    await screen.findByText("Cloud Sync");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
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
    const wrapper = withTabs(tabsContextValue({ workspace: makeWorkspace() }));
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

  it("backdrop click closes the modal", async () => {
    routeInvoke({
      sync_get_config: () => null,
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => true,
    });
    const onClose = vi.fn();
    const wrapper = withTabs(tabsContextValue({ workspace: makeWorkspace() }));
    const { container } = render(<SyncSettingsModal open={true} onClose={onClose} />, { wrapper });
    await screen.findByText("Cloud Sync");

    const overlay = container.querySelector(".settings-overlay") as HTMLElement;
    expect(overlay).not.toBeNull();
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalled();
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
    const wrapper = withTabs(tabsContextValue({ workspace: makeWorkspace() }));
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
    const wrapper = withTabs(tabsContextValue({ workspace: makeWorkspace() }));
    render(<SyncSettingsModal open={true} onClose={onClose} />, { wrapper });
    await screen.findByText("Cloud Sync");

    fireEvent.keyDown(window, { key: "Enter" });
    expect(onClose).not.toHaveBeenCalled();
  });
});
