import { readPluginsKey, writePluginsKey } from "./pluginsFile";

/** What the user has consented to for one plugin, persisted across restarts. */
export interface PluginGrant {
  /** The declared permissions the user accepted. */
  permissions: string[];
  /** The user explicitly accepted the full-trust (no sandbox) warning. */
  fullTrust: boolean;
}

const KEY = "grants";

const isGrantMap = (value: unknown): value is Record<string, PluginGrant> =>
  value !== null && typeof value === "object";

/** Read the persisted per-plugin grants. Missing/unreadable yields {}. */
export function loadGrants(): Promise<Record<string, PluginGrant>> {
  return readPluginsKey(KEY, isGrantMap, {});
}

/** Persist the per-plugin grants. */
export function saveGrants(grants: Record<string, PluginGrant>): Promise<void> {
  return writePluginsKey(KEY, grants);
}
