import { useEffect, useState } from "react";
import { usePluginsOptional } from "@/contexts/PluginsContext";
import { useRegistryEntries } from "@/hooks/usePluginRegistry";
import { useSettings } from "@/hooks/useSettings";
import type { MarkdownPlugin, SiteThemeContribution } from "@/lib/plugins/types";

// How long a headless render waits for the plugin host's startup load. A hung
// plugin must not hang a CI job forever: past this, the render proceeds with
// whatever themes have registered (a missing plugin theme then fails loudly
// with the available ids, which beats a silent stall).
export const CLI_PLUGIN_WAIT_MS = 10_000;

export interface ExportReadiness {
  /** Whether a headless render may start. */
  ready: boolean;
  /** Plugin-contributed site themes, offered alongside the built-ins. */
  themes: readonly SiteThemeContribution[];
  /** Plugin-contributed remark plugins, so plugin syntax renders. */
  remarkPlugins: readonly MarkdownPlugin[];
  /** Plugin-contributed rehype plugins, applied before the site rewriter. */
  rehypePlugins: readonly MarkdownPlugin[];
}

/**
 * What a headless render needs before it can start, and when it may.
 *
 * Persisted settings carry the print options an export honours, and the
 * plugin host's startup load decides which themes and syntax extensions
 * exist, so a render that begins too early silently produces a different
 * document. Shared by the one-shot CLI export and the serve loop, which
 * answer to the same conditions.
 */
export function useExportReadiness(): ExportReadiness {
  const plugins = usePluginsOptional();
  const themes = useRegistryEntries(plugins?.siteThemes ?? null);
  const remarkPlugins = useRegistryEntries(plugins?.remarkPlugins ?? null);
  const rehypePlugins = useRegistryEntries(plugins?.rehypePlugins ?? null);
  // Without a provider there are no plugins to wait for.
  const pluginsReady = plugins === null || plugins.initialLoadDone;
  const { loaded } = useSettings();

  const [waitExpired, setWaitExpired] = useState(false);
  useEffect(() => {
    if (pluginsReady) return;
    const timer = window.setTimeout(() => setWaitExpired(true), CLI_PLUGIN_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [pluginsReady]);

  return {
    ready: loaded && (pluginsReady || waitExpired),
    themes,
    remarkPlugins,
    rehypePlugins,
  };
}
