import { describe, expect, it, vi } from "vitest";
import type { WorkspaceSyncConfig } from "@/lib/sync";
import { commitSaveConfig, type FormState, resolveSaveConfig } from "./syncSettingsForm";

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
