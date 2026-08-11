import { KEYED_PROVIDERS, type KeyedProvider } from "@/lib/aiKeys";

/**
 * The secret slots Glyph manages, for the Settings audit view. A slot names a
 * place a secret can live; whether one is stored is asked of the backend per
 * slot, and the value itself never reaches this layer.
 */
export type SecretSlot =
  | { id: `ai-${KeyedProvider}`; kind: "ai"; provider: KeyedProvider }
  | { id: "sync-token"; kind: "sync" };

export const SYNC_TOKEN_SLOT: SecretSlot = { id: "sync-token", kind: "sync" };

/** Every managed slot, in display order. */
export const SECRET_SLOTS: readonly SecretSlot[] = [
  ...KEYED_PROVIDERS.map((provider) => ({ id: `ai-${provider}`, kind: "ai", provider }) as const),
  SYNC_TOKEN_SLOT,
];

/** Key into the `settings` bundle's `secrets.slots` block. */
export function slotLabelKey(slot: SecretSlot): string {
  return slot.kind === "ai" ? `secrets.slots.${slot.provider}` : "secrets.slots.syncToken";
}

/** Key into `secrets.status`. Neither "still checking" nor "the check failed"
 *  may collapse into "not set". */
export function presenceStatusKey(isSet: boolean | null | undefined): string {
  if (isSet === undefined) return "secrets.status.checking";
  if (isSet === null) return "secrets.status.unknown";
  return isSet ? "secrets.status.saved" : "secrets.status.notSet";
}
