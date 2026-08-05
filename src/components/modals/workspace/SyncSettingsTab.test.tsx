import { invoke } from "@tauri-apps/api/core";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceSyncConfig } from "@/lib/sync";
import { routeInvoke } from "@/test/fixtures/sync";
import { renderWithSync } from "@/test/renderWithSync";
import { SyncSettingsTab } from "./SyncSettingsTab";

// The modal chrome (Escape, backdrop, the no-workspace empty state) belongs to
// WorkspaceSettingsModal and is covered there; these cases drive the form.

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  // Default fallback so hooks that fire on mount (useSyncConfig) don't crash
  // in tests that don't care about the response. Individual tests override.
  vi.mocked(invoke).mockResolvedValue(null as unknown as never);
});

describe("SyncSettingsTab rendering", () => {
  it("renders the setup form prefilled with defaults for an unconfigured workspace", async () => {
    routeInvoke({ sync_get_config: () => null });
    renderWithSync(<SyncSettingsTab />);

    const branch = (await screen.findByPlaceholderText("main")) as HTMLInputElement;
    await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
    expect(branch.value).toBe("main");
    // Save is enabled even with a blank Remote URL, local-only sync is valid.
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
    renderWithSync(<SyncSettingsTab />);

    expect(await screen.findByRole("button", { name: "Save changes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync now" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disable sync" })).toBeInTheDocument();
    const remote = screen.getByPlaceholderText(
      "https://github.com/you/notes.git",
    ) as HTMLInputElement;
    await waitFor(() => expect(remote.value).toBe("https://example.com/r.git"));
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
    renderWithSync(<SyncSettingsTab />);

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
});
