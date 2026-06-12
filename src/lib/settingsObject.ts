import { DEFAULT_SETTINGS } from "./settings";

// Prototype-pollution-safe helpers for reading and writing the settings object.
// These are pure and have no React/Tauri dependencies, so they live here next to
// the settings schema rather than inside the provider.

const FORBIDDEN_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function isSafePlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  if (value === Object.prototype) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (FORBIDDEN_OBJECT_KEYS.has(key)) continue;
    if (isSafePlainObject(source[key]) && isSafePlainObject(target[key])) {
      result[key] = deepMerge(
        target[key] as Record<string, unknown>,
        source[key] as Record<string, unknown>,
      );
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

export function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const keys = path.split(".");
  if (keys.length === 0 || keys.some((k) => k === "")) {
    return obj;
  }

  const result = { ...obj };
  let current: Record<string, unknown> = result;
  // Schema allowlist: each path segment must be an own property of DEFAULT_SETTINGS
  // at the corresponding depth. This prevents prototype pollution even if the
  // FORBIDDEN_OBJECT_KEYS denylist ever misses a dangerous name.
  let schema: Record<string, unknown> = DEFAULT_SETTINGS as unknown as Record<string, unknown>;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (FORBIDDEN_OBJECT_KEYS.has(key)) {
      return obj;
    }
    // Defensive: `current` and `schema` are always plain objects here (the loop
    // only advances them to verified-plain values), so this guard cannot trip
    // given the fixed DEFAULT_SETTINGS schema.
    /* v8 ignore start */
    if (!isSafePlainObject(current) || !isSafePlainObject(schema)) {
      return obj;
    }
    /* v8 ignore stop */
    if (!Object.hasOwn(schema, key)) {
      return obj;
    }
    const schemaNext = schema[key];
    if (!isSafePlainObject(schemaNext)) {
      return obj;
    }
    const existing = Object.hasOwn(current, key) ? current[key] : undefined;
    if (isSafePlainObject(existing)) {
      current[key] = { ...existing };
    } else {
      current[key] = {};
    }
    const next = current[key] as Record<string, unknown>;
    // Defensive: `next` was just assigned a fresh plain object (a spread copy or
    // `{}`), so it is always a safe plain object.
    /* v8 ignore start */
    if (!isSafePlainObject(next)) {
      return obj;
    }
    /* v8 ignore stop */
    current = next;
    schema = schemaNext;
  }

  const lastKey = keys[keys.length - 1];
  if (FORBIDDEN_OBJECT_KEYS.has(lastKey)) {
    return obj;
  }
  // Defensive: `current` and `schema` are always plain objects when the loop
  // exits, so this final guard cannot trip.
  /* v8 ignore start */
  if (!isSafePlainObject(current) || !isSafePlainObject(schema)) {
    return obj;
  }
  /* v8 ignore stop */
  if (!Object.hasOwn(schema, lastKey)) {
    return obj;
  }

  current[lastKey] = value;
  return result;
}
