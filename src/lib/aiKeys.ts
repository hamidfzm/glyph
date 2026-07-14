import { getSecret, setSecret } from "./secrets";

/** Providers that authenticate with an API key. Ollama is local and keyless. */
export const KEYED_PROVIDERS = ["claude", "openai"] as const;
export type KeyedProvider = (typeof KEYED_PROVIDERS)[number];

/** Secret-manager account name for a provider's API key. */
function accountFor(provider: KeyedProvider): string {
  return `ai-api-key-${provider}`;
}

/** Read one provider's key from the OS keychain ("" when none is stored). */
export function getAiKey(provider: KeyedProvider): Promise<string> {
  return getSecret(accountFor(provider));
}

/** Store one provider's key in the OS keychain; "" deletes the entry. */
export function setAiKey(provider: KeyedProvider, value: string): Promise<void> {
  return setSecret(accountFor(provider), value);
}

/**
 * Load every stored provider key for the in-memory settings. A broken or
 * locked keychain yields an empty map instead of failing settings load; the
 * user sees the actionable error when they interact with the key field.
 */
export async function loadAiKeys(): Promise<Record<string, string>> {
  const keys: Record<string, string> = {};
  for (const provider of KEYED_PROVIDERS) {
    try {
      const value = await getAiKey(provider);
      if (value) keys[provider] = value;
    } catch (err) {
      console.error(`Failed to read the ${provider} API key from the keychain:`, err);
    }
  }
  return keys;
}
