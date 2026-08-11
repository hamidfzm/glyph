import { type KeyedProvider, setAiKey } from "@/lib/aiKeys";

// Keychain writes are debounced so typing a key doesn't hit the OS credential
// manager on every keystroke (Linux keyrings may prompt per write). Both the
// timers and the in-flight writes are module-level, not component state, so a
// removal elsewhere in Settings cancels a queued keystroke write and, once one
// has already left the debounce, still lands after it.
const KEY_SAVE_DEBOUNCE = 600;

const pending = new Map<KeyedProvider, ReturnType<typeof setTimeout>>();
const chains = new Map<KeyedProvider, Promise<void>>();

// Per-provider serialization: writes to one account complete in the order they
// were issued, so a removal can never be overtaken by the write it followed.
// A failed link still runs the next one; one locked-keyring error must not
// wedge the account for the rest of the session.
function chain(provider: KeyedProvider, value: string): Promise<void> {
  const write = () => setAiKey(provider, value);
  const next = (chains.get(provider) ?? Promise.resolve()).then(write, write);
  chains.set(provider, next);
  return next;
}

function cancelPending(provider: KeyedProvider): void {
  const timer = pending.get(provider);
  if (timer === undefined) return;
  clearTimeout(timer);
  pending.delete(provider);
}

/**
 * Queue a debounced keychain write, replacing any pending one for the same
 * provider. `onSettled` reports whether the write landed. The timer
 * deliberately survives unmount so a quickly-closed modal still saves.
 */
export function scheduleAiKeyWrite(
  provider: KeyedProvider,
  value: string,
  onSettled: (ok: boolean, error?: unknown) => void,
): void {
  cancelPending(provider);
  pending.set(
    provider,
    setTimeout(() => {
      pending.delete(provider);
      chain(provider, value).then(
        () => onSettled(true),
        (err) => onSettled(false, err),
      );
    }, KEY_SAVE_DEBOUNCE),
  );
}

/**
 * Store `value` now: drops any queued write for this provider and queues behind
 * whatever is already in flight. `""` removes the key.
 */
export function writeAiKeyNow(provider: KeyedProvider, value: string): Promise<void> {
  cancelPending(provider);
  return chain(provider, value);
}
