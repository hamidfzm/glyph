import { invoke } from "@tauri-apps/api/core";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceSyncConfig } from "@/lib/sync";
import { expectConsole } from "@/test/consoleGuard";
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

// The sync token is keyed by workspace path, so its audit row lives here
// rather than in the app-wide Saved Secrets list in global Settings.
describe("SyncSettingsTab token management", () => {
  const removeButton = () => screen.getByRole("button", { name: "Remove Personal access token" });

  it("reports a stored token and offers to remove it", async () => {
    routeInvoke({
      sync_get_config: () => null,
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => true,
      sync_has_token: () => true,
    });
    renderWithSync(<SyncSettingsTab />);

    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
    expect(screen.getByPlaceholderText("saved — leave blank to keep")).toBeInTheDocument();
    expect(removeButton()).toBeEnabled();
  });

  it("clears the token and re-reads what the keychain now holds", async () => {
    let stored = true;
    routeInvoke({
      sync_get_config: () => null,
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => true,
      sync_has_token: () => stored,
      sync_clear_token: () => {
        stored = false;
        return null;
      },
    });
    renderWithSync(<SyncSettingsTab />);
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());

    fireEvent.click(removeButton());

    await waitFor(() => expect(screen.getByText("Not set")).toBeInTheDocument());
    expect(invoke).toHaveBeenCalledWith("sync_clear_token", { workspacePath: "/w" });
  });

  it("keeps an unreadable keychain out of the 'not set' state", async () => {
    // A locked keyring must not report a stored token as gone.
    expectConsole(/Failed to check the sync token/);
    routeInvoke({
      sync_get_config: () => null,
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => true,
      sync_has_token: () => {
        throw new Error("keychain locked");
      },
    });
    renderWithSync(<SyncSettingsTab />);

    await waitFor(() => expect(screen.getByText("Couldn't be checked")).toBeInTheDocument());
    expect(screen.queryByText("Not set")).not.toBeInTheDocument();
    // Unknown presence still allows a removal attempt: it may well be stored.
    expect(removeButton()).toBeEnabled();
  });

  it("cannot remove a token the workspace does not have", async () => {
    routeInvoke({
      sync_get_config: () => null,
      sync_default_author: () => ({ name: null, email: null }),
      sync_repo_present: () => true,
      sync_has_token: () => false,
    });
    renderWithSync(<SyncSettingsTab />);

    await waitFor(() => expect(screen.getByText("Not set")).toBeInTheDocument());
    expect(removeButton()).toBeDisabled();
  });
});
