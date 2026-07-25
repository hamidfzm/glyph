import { readPluginsKey, writePluginsKey } from "./pluginsFile";

// Which plugins the user has deactivated, persisted so the choice survives
// restarts (VS Code-style disable).
const KEY = "disabled";

const isIdList = (value: unknown): value is string[] => Array.isArray(value);

/** Read the persisted disabled-id list. Missing/unreadable yields []. */
export function loadDisabled(): Promise<string[]> {
  return readPluginsKey(KEY, isIdList, []);
}

/** Persist the disabled-id list. */
export function saveDisabled(ids: string[]): Promise<void> {
  return writePluginsKey(KEY, ids);
}
