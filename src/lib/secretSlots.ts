import { KEYED_PROVIDERS, type KeyedProvider } from "@/lib/aiKeys";

/**
 * The secret slots the global Settings audit view manages. A slot names a place
 * a secret can live; whether one is stored is asked of the backend per slot, and
 * the value itself never reaches this layer.
 *
 * Only app-wide secrets belong here. The Cloud Sync token is keyed by workspace
 * path, so it is managed in that workspace's own Sync settings tab instead.
 */
export interface SecretSlot {
  id: `ai-${KeyedProvider}`;
  provider: KeyedProvider;
}

/** Every managed slot, in display order. */
export const SECRET_SLOTS: readonly SecretSlot[] = KEYED_PROVIDERS.map((provider) => ({
  id: `ai-${provider}`,
  provider,
}));

/** Key into the `settings` bundle's `secrets.slots` block. */
export function slotLabelKey(slot: SecretSlot): string {
  return `secrets.slots.${slot.provider}`;
}

/** Key into `secrets.status`. Neither "still checking" nor "the check failed"
 *  may collapse into "not set". */
export function presenceStatusKey(isSet: boolean | null | undefined): string {
  if (isSet === undefined) return "secrets.status.checking";
  if (isSet === null) return "secrets.status.unknown";
  return isSet ? "secrets.status.saved" : "secrets.status.notSet";
}
