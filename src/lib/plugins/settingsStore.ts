import { load } from "@tauri-apps/plugin-store";

// Per-plugin persisted settings, stored next to the disabled-list in
// plugins.json under one "settings" key: { [pluginId]: { [key]: value } }.
// The host hydrates a plugin's map before activate() so ctx.settings.get is
// synchronous for authors; set() persists fire-and-forget.
const FILE = "plugins.json";
const KEY = "settings";

type AllSettings = Record<string, Record<string, unknown>>;

async function readAll(): Promise<AllSettings> {
  try {
    const store = await load(FILE, { defaults: {}, autoSave: true });
    const value = await store.get<AllSettings>(KEY);
    return value && typeof value === "object" ? value : {};
  } catch {
    return {}; // No store yet, or unreadable: every plugin starts empty.
  }
}

/** Read one plugin's persisted settings map. Missing/unreadable yields {}. */
export async function loadPluginSettings(pluginId: string): Promise<Record<string, unknown>> {
  const all = await readAll();
  const own = all[pluginId];
  return own && typeof own === "object" ? own : {};
}

/** Persist one plugin's settings map (replaces that plugin's entry only). */
export async function savePluginSettings(
  pluginId: string,
  settings: Record<string, unknown>,
): Promise<void> {
  const all = await readAll();
  const store = await load(FILE, { defaults: {}, autoSave: true });
  await store.set(KEY, { ...all, [pluginId]: settings });
}
