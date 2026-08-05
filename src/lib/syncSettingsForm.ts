import type { ConflictPolicy, WorkspaceSyncConfig } from "@/lib/sync";

// The editable shape behind the cloud-sync settings form, and the two
// operations that cross it: turning a stored config into form values, and
// turning form values back into a persisted config plus the commands that
// enable sync for the workspace.

export interface FormState {
  remoteUrl: string;
  remoteBranch: string;
  conflictPolicy: ConflictPolicy;
  authorName: string;
  authorEmail: string;
  /** Plain-text PAT. Never displayed back — re-entered each session. */
  token: string;
  /**
   * Per-sync commit subject. Lives in form state (not the persisted
   * config) because it resets between runs; blank delegates to the
   * backend's auto-generator.
   */
  commitMessage: string;
}

export function formFromConfig(config: WorkspaceSyncConfig): FormState {
  return {
    remoteUrl: config.remoteUrl,
    remoteBranch: config.remoteBranch,
    conflictPolicy: config.conflictPolicy,
    authorName: config.author?.name ?? "",
    authorEmail: config.author?.email ?? "",
    token: "",
    commitMessage: "",
  };
}

function configFromForm(workspacePath: string, form: FormState): WorkspaceSyncConfig {
  const author =
    form.authorName.trim() || form.authorEmail.trim()
      ? { name: form.authorName.trim(), email: form.authorEmail.trim() }
      : null;
  return {
    workspacePath,
    backend: "git",
    remoteUrl: form.remoteUrl.trim(),
    remoteBranch: form.remoteBranch.trim() || "main",
    conflictPolicy: form.conflictPolicy,
    author,
  };
}

/**
 * Resolve the config to persist from the current form, or null when there's no
 * folder workspace selected. A blank remote URL is allowed: it enables
 * local-only sync (commit history without a remote to push to).
 */
export function resolveSaveConfig(
  workspacePath: string | null,
  form: FormState,
): WorkspaceSyncConfig | null {
  if (!workspacePath) return null;
  return configFromForm(workspacePath, form);
}

export interface CommitSaveDeps {
  repoPresent: boolean | null;
  initRepo: (defaultBranch: string | null, remoteUrl: string | null) => Promise<void>;
  save: (config: WorkspaceSyncConfig) => Promise<void>;
  setOrigin: (remoteUrl: string) => Promise<void>;
  setToken: (token: string) => Promise<void>;
  clearTokenField: () => void;
  commitConfig: () => Promise<boolean>;
}

/**
 * Enable sync for the workspace: turn the folder into a git repo if it isn't
 * one, persist `next`, propagate the remote URL + token, and land the config
 * in history. A no-op when `next` is null (nothing actionable to save).
 */
export async function commitSaveConfig(
  next: WorkspaceSyncConfig | null,
  token: string,
  deps: CommitSaveDeps,
): Promise<void> {
  if (!next) return;
  // Enabling sync on a plain folder turns it into a git repo first, so the
  // commit step below (and later syncs) have a repository to write to.
  if (!deps.repoPresent) {
    await deps.initRepo(next.remoteBranch, next.remoteUrl || null);
  }
  await deps.save(next);
  // Glyph's stored config is advisory; libgit2 reads `remote.origin.url`
  // from the workspace's .git/config for the actual transport. Push the
  // form value over so a Save-then-Sync uses the URL the user just typed.
  // Skipped for local-only setups (blank URL) — there's no origin to set.
  if (next.remoteUrl) {
    try {
      await deps.setOrigin(next.remoteUrl);
    } catch {
      // setOrigin failures already surface in the hook's error state.
    }
  }
  const trimmed = token.trim();
  if (trimmed) {
    await deps.setToken(trimmed);
    deps.clearTokenField();
  }
  // Commit the `.glyph/` config so it persists and travels with clones,
  // rather than waiting for the first content sync.
  try {
    await deps.commitConfig();
  } catch {
    // commitConfig failures already surface in the hook's error state.
  }
}
