import { useRegistryEntries } from "@/hooks/usePluginRegistry";
import { overlays } from "@/lib/plugins/overlays";
import { PluginOverlayLayer } from "./PluginOverlayLayer";

/** The overlay a plugin opened with `ctx.ui.openOverlay`, if any. */
export function PluginOverlay() {
  const overlay = useRegistryEntries(overlays).at(-1);
  if (!overlay) return null;
  return <PluginOverlayLayer overlay={overlay} />;
}
