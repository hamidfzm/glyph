import { KEYED_PROVIDERS, type KeyedProvider } from "@/lib/aiKeys";

/**
 * The secret slots the global Settings audit view manages. A slot names a place
 * a secret can live; whether one is stored is asked of the backend per slot, and
 * the value itself never reaches this layer.
 *
 * Only the AI provider keys belong here. A sync token is managed beside its
 * remote: a workspace's in that workspace's own Sync settings tab, the
 * settings repo's in the Sync tab of Settings.
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
