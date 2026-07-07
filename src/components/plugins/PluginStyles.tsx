import { usePluginsOptional } from "@/contexts/PluginsContext";
import { useRegistryEntries } from "@/hooks/usePluginRegistry";

/**
 * Stylesheets contributed by plugins via `ctx.ui.addStyles`, rendered as
 * managed <style> elements after the app's own styles so plugin rules win
 * ties. Unloading a plugin removes its registry entries, which unmounts the
 * matching elements. Renders nothing without a provider or contributions.
 */
export function PluginStyles() {
  const plugins = usePluginsOptional();
  const styles = useRegistryEntries(plugins?.styles ?? null);

  if (styles.length === 0) return null;
  return (
    <>
      {styles.map((style, index) => (
        // Entries are append-only per activation; index keys are stable enough.
        // biome-ignore lint/suspicious/noArrayIndexKey: no stable id on CSS text
        <style data-plugin-style key={index}>
          {style.css}
        </style>
      ))}
    </>
  );
}
