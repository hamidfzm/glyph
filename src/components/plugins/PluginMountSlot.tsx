import { useEffect, useRef } from "react";
import { DisposerBag } from "@/lib/plugins/disposer";
import type { MountContribution } from "@/lib/plugins/types";

interface PluginMountSlotProps {
  contribution: MountContribution;
  className?: string;
  /** Called when `mount()` throws, for a host that should not keep an empty slot. */
  onError?: () => void;
}

/**
 * Host element for one framework-agnostic plugin contribution. Runs the
 * contribution's `mount(el, registerCleanup)` in an effect, collects whatever
 * cleanup it registers, and runs it (plus clearing the DOM) on unmount or when
 * the contribution is replaced. A throwing mount is contained here so one bad
 * plugin can't take down the surrounding UI.
 */
export function PluginMountSlot({ contribution, className, onError }: PluginMountSlotProps) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const bag = new DisposerBag();
    try {
      contribution.mount(el, (cleanup) => bag.add(cleanup));
    } catch (err) {
      console.error(`Plugin contribution ${contribution.id} threw in mount():`, err);
      onError?.();
    }
    return () => {
      bag.dispose();
      el.replaceChildren();
    };
  }, [contribution, onError]);

  return <span ref={ref} className={className} data-plugin-slot={contribution.id} />;
}
