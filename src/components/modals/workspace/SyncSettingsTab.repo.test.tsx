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

describe("SyncSettingsTab repository actions", () => {
  it("shows the Initialize banner when the workspace isn't a git repo yet", async () => {
    routeInvoke({
      sync_get_config: () => null,
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => false,
    });
    renderWithSync(<SyncSettingsTab />);

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
    renderWithSync(<SyncSettingsTab />);

    const initBtn = await screen.findByRole("button", { name: "Initialize repo" });
    fireEvent.click(initBtn);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("sync_init_repo", expect.anything()));
    await waitFor(() => expect(screen.queryByTestId("sync-init-banner")).toBeNull());
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
    renderWithSync(<SyncSettingsTab />);

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
    renderWithSync(<SyncSettingsTab />);

    fireEvent.click(await screen.findByRole("button", { name: "Disable sync" }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("sync_remove_config", { workspacePath: "/w" }),
    );
    await waitFor(() => expect(screen.queryByRole("button", { name: "Disable sync" })).toBeNull());
    expect(screen.getByRole("button", { name: "Save config" })).toBeInTheDocument();
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
    renderWithSync(<SyncSettingsTab />);

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
});
