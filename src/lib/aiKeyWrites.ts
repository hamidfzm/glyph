import { type KeyedProvider, setAiKey } from "@/lib/aiKeys";

// Keychain writes are debounced so typing a key doesn't hit the OS credential
// manager on every keystroke (Linux keyrings may prompt per write). The timers
// are module-level, not component state, so removing a key elsewhere in
// Settings can cancel a pending keystroke write instead of being silently
// undone by it a moment later.
const KEY_SAVE_DEBOUNCE = 600;

const pending = new Map<KeyedProvider, ReturnType<typeof setTimeout>>();

/**
 * Queue a keychain write for `provider`, replacing any pending one. `onSettled`
 * receives the rejection reason, or `null` once the write lands. The timer
 * deliberately survives unmount so a quickly-closed modal still saves.
 */
export function scheduleAiKeyWrite(
  provider: KeyedProvider,
  value: string,
  onSettled: (error: unknown) => void,
): void {
  cancelAiKeyWrite(provider);
  pending.set(
    provider,
    setTimeout(() => {
      pending.delete(provider);
      setAiKey(provider, value).then(
        () => onSettled(null),
        (err) => onSettled(err),
      );
    }, KEY_SAVE_DEBOUNCE),
  );
}

/** Drop a queued write so a later removal isn't overwritten by it. */
export function cancelAiKeyWrite(provider: KeyedProvider): void {
  const timer = pending.get(provider);
  if (timer === undefined) return;
  clearTimeout(timer);
  pending.delete(provider);
}
