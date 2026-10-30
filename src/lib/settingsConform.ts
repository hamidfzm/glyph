import { DEFAULT_SETTINGS } from "./settings";
import { FORBIDDEN_OBJECT_KEYS, isSafePlainObject } from "./settingsObject";

// Stored settings can arrive from another machine through settings sync, so a
// value of the wrong type must not reach a component that assumes the schema.
// Keys the schema does not know pass through untouched: a newer Glyph on the
// other machine may have written them, and dropping them here would delete
// them there on the next sync.

type Check = (value: unknown) => boolean;

function isBlockLayout(value: unknown): boolean {
  if (!isSafePlainObject(value)) return false;
  const height = value.height;
  return (height === null || typeof height === "number") && typeof value.collapsed === "boolean";
}

/** Maps whose defaults cannot give their values' type: keyed by free-form ids,
 *  or holding `null` until the user chooses. */
const RECORD_VALUES: Record<string, Check> = {
  "layout.blocks": isBlockLayout,
  "keybindings.overrides": (value) => typeof value === "string",
  "ai.apiKeys": (value) => typeof value === "string",
  "ai.agentWriteTools": (value) => typeof value === "boolean",
  "ai.assistantTools": (value) => value === null || typeof value === "boolean",
};

/** `stored` with every value whose type differs from its default left out,
 *  so the default applies there instead. */
export function conformToDefaults(stored: Record<string, unknown>): Record<string, unknown> {
  return conformObject(stored, DEFAULT_SETTINGS as unknown as Record<string, unknown>, "");
}

function conformObject(
  stored: Record<string, unknown>,
  defaults: Record<string, unknown>,
  prefix: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(stored)) {
    // Assigned to a plain object, these would replace its prototype.
    if (FORBIDDEN_OBJECT_KEYS.has(key)) continue;
    if (!Object.hasOwn(defaults, key)) {
      out[key] = value;
      continue;
    }
    const conformed = conformValue(value, defaults[key], `${prefix}${key}`);
    if (conformed !== undefined) out[key] = conformed;
  }
  return out;
}

function conformValue(value: unknown, fallback: unknown, path: string): unknown {
  const recordCheck = RECORD_VALUES[path];
  if (recordCheck) {
    if (!isSafePlainObject(value)) return undefined;
    return Object.fromEntries(
      Object.entries(value).filter(([k, v]) => !FORBIDDEN_OBJECT_KEYS.has(k) && recordCheck(v)),
    );
  }
  if (isSafePlainObject(fallback)) {
    return isSafePlainObject(value) ? conformObject(value, fallback, `${path}.`) : undefined;
  }
  if (Array.isArray(fallback)) {
    if (!Array.isArray(value)) return undefined;
    if (fallback.length === 0) return value;
    const itemType = typeof fallback[0];
    return value.filter((item) => typeof item === itemType);
  }
  return typeof value === typeof fallback ? value : undefined;
}
