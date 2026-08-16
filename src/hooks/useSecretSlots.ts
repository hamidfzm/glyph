import { useCallback, useEffect, useRef, useState } from "react";
import { useSettings } from "@/hooks/useSettings";
import { hasAiKey } from "@/lib/aiKeys";
import { writeAiKeyNow } from "@/lib/aiKeyWrites";
import { SECRET_SLOTS, type SecretSlot } from "@/lib/secretSlots";

/** `undefined` is "not checked yet" and `null` is "the check failed"; neither
 *  may be rendered as "not set". */
export type SlotPresence = Record<string, boolean | null | undefined>;

export interface UseSecretSlotsReturn {
  slots: readonly SecretSlot[];
  presence: SlotPresence;
  /** Id of the slot currently being written, if any. */
  busySlotId: string | null;
  /** Translation key for the last failure, so a locale switch can't re-run the
   *  keychain lookups. */
  errorKey: string | null;
  remove: (slot: SecretSlot) => Promise<void>;
  save: (slot: SecretSlot, value: string) => Promise<void>;
}

/**
 * Presence and management for the app-wide secret slots Glyph stores in the OS
 * keychain. Only booleans cross the IPC boundary here; reading a stored value
 * back is deliberately not part of this surface.
 */
export function useSecretSlots(): UseSecretSlotsReturn {
  const { settings, updateSettings } = useSettings();
  const [presence, setPresence] = useState<SlotPresence>({});
  const [busySlotId, setBusySlotId] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  // Slots written while the in-flight lookup batch was running. Their result is
  // fresher than the batch's, so the batch must not overwrite them.
  const writtenSinceCheck = useRef(new Set<string>());

  const apiKeys = settings.ai.apiKeys;

  useEffect(() => {
    let cancelled = false;
    writtenSinceCheck.current.clear();
    Promise.all(
      SECRET_SLOTS.map((slot) =>
        hasAiKey(slot.provider)
          .then((isSet) => ({ id: slot.id, isSet: isSet as boolean | null }))
          .catch((err) => {
            console.error(`Failed to check the ${slot.id} secret slot:`, err);
            return { id: slot.id, isSet: null, failed: true };
          }),
      ),
    ).then((results) => {
      if (cancelled) return;
      setPresence((prev) => {
        const checked: SlotPresence = Object.fromEntries(results.map((r) => [r.id, r.isSet]));
        for (const id of writtenSinceCheck.current) checked[id] = prev[id];
        return checked;
      });
      setErrorKey(results.some((r) => "failed" in r) ? "secrets.errors.read" : null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const run = useCallback(
    async (slot: SecretSlot, isSet: boolean, failureKey: string, write: () => Promise<void>) => {
      setBusySlotId(slot.id);
      writtenSinceCheck.current.add(slot.id);
      try {
        await write();
        setPresence((prev) => ({ ...prev, [slot.id]: isSet }));
        setErrorKey(null);
      } catch (err) {
        console.error(`Failed to update the ${slot.id} secret slot:`, err);
        // The keychain state is now unknown; claiming either way would lie.
        setPresence((prev) => ({ ...prev, [slot.id]: null }));
        setErrorKey(failureKey);
      } finally {
        setBusySlotId(null);
      }
    },
    [],
  );

  const remove = useCallback(
    async (slot: SecretSlot) =>
      run(slot, false, "secrets.errors.remove", async () => {
        // Goes through the shared writer so a keystroke write queued on the AI
        // tab is cancelled, or completes first, instead of racing this delete.
        await writeAiKeyNow(slot.provider, "");
        const remaining = { ...apiKeys };
        delete remaining[slot.provider];
        updateSettings("ai.apiKeys", remaining);
      }),
    [run, apiKeys, updateSettings],
  );

  const save = useCallback(
    async (slot: SecretSlot, value: string) =>
      run(slot, true, "secrets.errors.save", async () => {
        await writeAiKeyNow(slot.provider, value);
        updateSettings("ai.apiKeys", { ...apiKeys, [slot.provider]: value });
      }),
    [run, apiKeys, updateSettings],
  );

  return { slots: SECRET_SLOTS, presence, busySlotId, errorKey, remove, save };
}
