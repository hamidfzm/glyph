import { invoke } from "@tauri-apps/api/core";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceSyncConfig } from "@/lib/sync";
import { routeInvoke } from "@/test/fixtures/sync";
import { renderWithSync } from "@/test/renderWithSync";
import { SyncSettingsTab } from "./SyncSettingsTab";

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  // Default fallback so hooks that fire on mount (useSyncConfig) don't crash
  // in tests that don't care about the response. Individual tests override.
  vi.mocked(invoke).mockResolvedValue(null as unknown as never);
});

describe("SyncSettingsTab running a sync", () => {
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
    renderWithSync(<SyncSettingsTab />);

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

  it("keeps a typed commit message when a fresh config prefills the form", async () => {
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
      sync_set_config: () => null,
      sync_set_origin: () => null,
      sync_commit_config: () => true,
    });
    renderWithSync(<SyncSettingsTab />);

    const msgInput = (await screen.findByPlaceholderText("e.g. Update notes")) as HTMLInputElement;
    fireEvent.change(msgInput, { target: { value: "fix readme" } });
    // Saving installs a new config object, which re-runs the prefill.
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("sync_commit_config", { workspacePath: "/w" }),
    );
    expect(msgInput.value).toBe("fix readme");
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
    renderWithSync(<SyncSettingsTab />);

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
    renderWithSync(<SyncSettingsTab />);

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
    renderWithSync(<SyncSettingsTab />);

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
    renderWithSync(<SyncSettingsTab />);

    fireEvent.click(await screen.findByRole("button", { name: "Refresh status" }));
    const block = await screen.findByTestId("sync-status");
    await waitFor(() => expect(block.textContent).toMatch(/Unresolved conflicts: a\.md, b\.md/));
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
    renderWithSync(<SyncSettingsTab />);

    fireEvent.click(await screen.findByRole("button", { name: "Sync now" }));
    expect(await screen.findByText(/Authentication failed: bad token/)).toBeInTheDocument();
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
      const { unmount } = renderWithSync(<SyncSettingsTab />);
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
    renderWithSync(<SyncSettingsTab />);

    fireEvent.click(await screen.findByRole("button", { name: "Refresh status" }));
    const block = await screen.findByTestId("sync-status");
    await waitFor(() => expect(block.textContent).toMatch(/Last sync: never/));
  });
});
