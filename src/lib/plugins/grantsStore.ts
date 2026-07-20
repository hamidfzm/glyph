import { load } from "@tauri-apps/plugin-store";

/** What the user has consented to for one plugin, persisted across restarts. */
export interface PluginGrant {
  /** The declared permissions the user accepted. */
  permissions: string[];
  /** The user explicitly accepted the full-trust (no sandbox) warning. */
  fullTrust: boolean;
}

// Shares the plugins store file with the disabled-id list.
const FILE = "plugins.json";
const KEY = "grants";

/** Read the persisted per-plugin grants. Missing/unreadable yields {}. */
export async function loadGrants(): Promise<Record<string, PluginGrant>> {
  try {
    const store = await load(FILE, { defaults: {}, autoSave: true });
    const value = await store.get<Record<string, PluginGrant>>(KEY);
    return value && typeof value === "object" ? value : {};
  } catch {
    return {}; // No store yet: nothing has been granted.
  }
}

/** Persist the per-plugin grants. */
export async function saveGrants(grants: Record<string, PluginGrant>): Promise<void> {
  const store = await load(FILE, { defaults: {}, autoSave: true });
  await store.set(KEY, grants);
}
