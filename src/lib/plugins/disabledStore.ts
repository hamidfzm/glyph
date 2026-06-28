import { load } from "@tauri-apps/plugin-store";

// Which plugins the user has deactivated, persisted next to settings.json in a
// small store file so the choice survives restarts (VS Code-style disable).
const FILE = "plugins.json";
const KEY = "disabled";

/** Read the persisted disabled-id list. Missing/unreadable yields []. */
export async function loadDisabled(): Promise<string[]> {
  try {
    const store = await load(FILE, { defaults: {}, autoSave: true });
    const value = await store.get<string[]>(KEY);
    return Array.isArray(value) ? value : [];
  } catch {
    return []; // No store yet, or it's unreadable: treat everything as enabled.
  }
}

/** Persist the disabled-id list. */
export async function saveDisabled(ids: string[]): Promise<void> {
  const store = await load(FILE, { defaults: {}, autoSave: true });
  await store.set(KEY, ids);
}
