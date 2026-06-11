import { useSyncExternalStore } from "react";
import type { Registry } from "@/lib/plugins/registry";

const EMPTY: readonly never[] = [];
const noopSubscribe = () => () => {};
const emptySnapshot = () => EMPTY;

/**
 * Subscribe to a plugin contribution registry and re-render when its entries
 * change. Accepts `null` (no PluginsProvider mounted, e.g. component tests)
 * and yields a stable empty list in that case, so callers never need
 * conditional hooks.
 */
export function useRegistryEntries<T>(registry: Registry<T> | null | undefined): readonly T[] {
  return useSyncExternalStore(
    registry ? registry.subscribe : noopSubscribe,
    (registry ? registry.list : emptySnapshot) as () => readonly T[],
  );
}
