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
/**
 * One plugin's grant, from its own entry only: the map is keyed by plugin id,
 * and an id the prototype answers for (`constructor`) would otherwise read as
 * a grant nobody gave.
 */
export function grantOf(grants: Record<string, PluginGrant>, id: string): PluginGrant | undefined {
  return Object.hasOwn(grants, id) ? grants[id] : undefined;
}

export function loadGrants(): Promise<Record<string, PluginGrant>> {
  return readPluginsKey(KEY, isGrantMap, {});
}

/** Persist the per-plugin grants. */
export function saveGrants(grants: Record<string, PluginGrant>): Promise<void> {
  return writePluginsKey(KEY, grants);
}
