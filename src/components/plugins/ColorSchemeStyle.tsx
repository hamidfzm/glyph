import { useColorScheme } from "@/hooks/useColorScheme";

/**
 * The picked color scheme's stylesheet, the only scheme in the document. It
 * renders before the `ctx.ui.addStyles` sheets so those still win ties, and
 * nothing while its plugin is missing, which leaves the default palette.
 */
export function ColorSchemeStyle() {
  const { status } = useColorScheme();
  if (status.kind !== "active") return null;
  return <style data-color-scheme>{status.scheme.css}</style>;
}
