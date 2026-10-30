import { readPluginsKey, writePluginsKey } from "./pluginsFile";

// Per-plugin persisted settings under one "settings" key:
// { [pluginId]: { [key]: value } }. The host hydrates a plugin's map before
// activate() so ctx.settings.get is synchronous for authors; set() persists
// fire-and-forget, one key at a time: a settings sync may have rewritten the
// plugin's other keys since it hydrated, and its copy of them is stale.
const KEY = "settings";

// Each save rewrites the whole key, so saves run one at a time in call order:
// a save reads the key only after the previous save has finished.
let lastSave: Promise<void> = Promise.resolve();

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

/** Persist one key of a plugin's settings, leaving its other keys, and every
 *  other plugin's, as the store holds them now. */
export function savePluginSetting(pluginId: string, key: string, value: unknown): Promise<void> {
  const save = saveAfter(lastSave, pluginId, key, value);
  lastSave = save;
  return save;
}

async function saveAfter(
  previous: Promise<void>,
  pluginId: string,
  key: string,
  value: unknown,
): Promise<void> {
  // A failed save rejects only its own caller; this save still runs.
  await previous.catch(() => {});
  const all = await readAll();
  const own = all[pluginId] && typeof all[pluginId] === "object" ? all[pluginId] : {};
  await writePluginsKey(KEY, { ...all, [pluginId]: { ...own, [key]: value } });
}
