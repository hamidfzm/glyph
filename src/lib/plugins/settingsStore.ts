import { readPluginsKey, writePluginsKey } from "./pluginsFile";

// Per-plugin persisted settings under one "settings" key:
// { [pluginId]: { [key]: value } }. The host hydrates a plugin's map before
// activate() so ctx.settings.get is synchronous for authors; set() persists
// fire-and-forget.
const KEY = "settings";

type AllSettings = Record<string, Record<string, unknown>>;

const isSettingsMap = (value: unknown): value is AllSettings =>
  value !== null && typeof value === "object";

function readAll(): Promise<AllSettings> {
  return readPluginsKey(KEY, isSettingsMap, {});
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
  await writePluginsKey(KEY, { ...all, [pluginId]: settings });
}
