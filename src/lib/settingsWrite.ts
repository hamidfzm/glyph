import { DEFAULT_SETTINGS, type Settings } from "./settings";
import { migrateLegacySettings } from "./settingsMigrations";
import { deepMerge, getNestedValue, setNestedValue } from "./settingsObject";

// How a settings write is assembled. Pure, so the merge is testable without
// rendering a provider and driving its debounce.

/** Rebuild a full `Settings` from what is currently persisted. */
export function settingsFromStored(stored: Partial<Settings> | null | undefined): Settings {
  if (!stored) return DEFAULT_SETTINGS;
  return deepMerge(
    DEFAULT_SETTINGS as unknown as Record<string, unknown>,
    migrateLegacySettings(stored as unknown as Record<string, unknown>),
  ) as unknown as Settings;
}

/**
 * The blob to persist: what is on disk right now, with only `changedPaths`
 * re-applied from `pending`.
 *
 * Every window holds its own copy of the settings, so writing that copy whole
 * would undo whatever another window changed meanwhile. Re-applying just the
 * paths this window actually touched keeps both windows' edits.
 */
export function mergeChangedPaths(
  stored: Partial<Settings> | null | undefined,
  pending: Settings,
  changedPaths: Iterable<string>,
): Settings {
  const source = pending as unknown as Record<string, unknown>;
  let merged = settingsFromStored(stored) as unknown as Record<string, unknown>;
  for (const path of changedPaths) {
    merged = setNestedValue(merged, path, getNestedValue(source, path));
  }
  return merged as unknown as Settings;
}
