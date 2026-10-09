import { useLayoutEffect } from "react";
import { useRegistryEntries } from "@/hooks/usePluginRegistry";
import { overlays } from "@/lib/plugins/overlays";
import { PluginOverlayLayer } from "./PluginOverlayLayer";

/** The overlay a plugin opened with `ctx.ui.openOverlay`, if any. */
export function PluginOverlay() {
  const overlay = useRegistryEntries(overlays).at(-1);

  // Registered once, when the plugin layer mounts and so before any plugin
  // loads: Escape reaches this listener ahead of one a plugin adds, whenever
  // it adds it. Hardening against a misbehaving plugin, not a boundary; a
  // full-trust plugin shares this page and can still get in the way.
  useLayoutEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const open = overlays.list().at(-1);
      if (e.key !== "Escape" || !open) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      open.close();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, []);

  if (!overlay) return null;
  return <PluginOverlayLayer overlay={overlay} />;
}
