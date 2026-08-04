import type { Store } from "@tauri-apps/plugin-store";
import { KEYED_PROVIDERS, loadAiKeys, setAiKey } from "@/lib/aiKeys";
import { type Settings, stripSecrets } from "@/lib/settings";

/**
 * Move any legacy plaintext API keys from settings.json into the OS keychain,
 * then overlay the keychain's stored keys onto the in-memory settings. The
 * plaintext copy is removed from the store only once every key migrated, so a
 * locked keyring never destroys the only copy of a key; every subsequent store
 * write is stripped regardless (see saveToStore). Never throws.
 */
export async function loadSecrets(
  store: Store,
  storeKey: string,
  merged: Settings,
): Promise<Settings> {
  const legacy = merged.ai.apiKeys;
  const legacyProviders = KEYED_PROVIDERS.filter((p) => legacy[p]);
  let migrated = true;
  for (const provider of legacyProviders) {
    try {
      await setAiKey(provider, legacy[provider]);
    } catch (err) {
      migrated = false;
      console.error(`Failed to migrate the ${provider} API key to the keychain:`, err);
    }
  }
  const withKeys: Settings = {
    ...merged,
    ai: { ...merged.ai, apiKeys: { ...legacy, ...(await loadAiKeys()) } },
  };
  if (legacyProviders.length > 0 && migrated) {
    try {
      await store.set(storeKey, stripSecrets(withKeys));
    } catch (err) {
      console.error("Failed to remove migrated API keys from settings.json:", err);
    }
  }
  return withKeys;
}
