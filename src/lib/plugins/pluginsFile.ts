import { openStore } from "@/lib/store";

// All plugin bookkeeping (disabled ids, consent grants, per-plugin settings)
// shares one store file next to settings.json; each module owns one key.
const FILE = "plugins.json";

/** Read one key. A missing, invalid, or unreadable store yields the fallback. */
export async function readPluginsKey<T>(
  key: string,
  isValid: (value: unknown) => value is T,
  fallback: T,
): Promise<T> {
  try {
    const store = await openStore(FILE);
    const value = await store.get<T>(key);
    return isValid(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

/** Persist one key. */
export async function writePluginsKey(key: string, value: unknown): Promise<void> {
  const store = await openStore(FILE);
  await store.set(key, value);
}
