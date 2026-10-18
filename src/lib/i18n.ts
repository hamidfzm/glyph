import i18next from "i18next";
import resourcesToBackend from "i18next-resources-to-backend";
import { initReactI18next } from "react-i18next";
import { FALLBACK_LOCALE, NAMESPACES } from "@/lib/locales";
import enAi from "@/locales/en/ai.json";
import enCommands from "@/locales/en/commands.json";
import enCommon from "@/locales/en/common.json";
import enMenu from "@/locales/en/menu.json";
import enPlugins from "@/locales/en/plugins.json";
import enSettings from "@/locales/en/settings.json";
import enSync from "@/locales/en/sync.json";
import enWorkspace from "@/locales/en/workspace.json";
import enWorkspaceSettings from "@/locales/en/workspaceSettings.json";

// Every non-English locale JSON is code-split into its own chunk (Vite turns
// each `import()` into a separate file) and fetched only when that locale is
// first activated. English is excluded from the lazy set and bundled inline
// below, so first paint and missing-key fallback never wait on a load.
const localeFiles = import.meta.glob<Record<string, unknown>>(
  ["@/locales/*/*.json", "!@/locales/en/**"],
  { import: "default" },
);

// Keyed by `<locale>/<namespace>`, the last two segments of every path the glob
// matches, because Vite writes glob keys relative to the build's root:
// `/src/locales/…` in the app, `../locales/…` in the preview and web builds.
const localeChunks = new Map<string, () => Promise<Record<string, unknown>>>();
for (const [path, load] of Object.entries(localeFiles)) {
  localeChunks.set(path.replace(/^.*\/([^/]+\/[^/]+)\.json$/, "$1"), load);
}

export const i18n = i18next;

i18n
  .use(
    // On-demand loader: resolves `<locale>/<namespace>.json` to its lazy chunk.
    // English is bundled (returns null here); unknown locale/namespace pairs
    // resolve to null and fall back to English.
    resourcesToBackend(async (lng: string, ns: string) => {
      if (lng === FALLBACK_LOCALE) return null;
      const load = localeChunks.get(`${lng}/${ns}`);
      return load ? await load() : null;
    }),
  )
  .use(initReactI18next)
  .init({
    // English inline as the synchronous fallback; other locales load lazily via
    // the backend above. `partialBundledLanguages` lets the two coexist.
    resources: {
      en: {
        common: enCommon,
        settings: enSettings,
        workspaceSettings: enWorkspaceSettings,
        commands: enCommands,
        ai: enAi,
        sync: enSync,
        workspace: enWorkspace,
        menu: enMenu,
        plugins: enPlugins,
      },
    },
    partialBundledLanguages: true,
    lng: FALLBACK_LOCALE,
    fallbackLng: FALLBACK_LOCALE,
    defaultNS: "common",
    // A copy: i18next appends every namespace it later sees to the array it
    // is given, and the list stays the app's own (see pluginNamespace.ts).
    ns: [...NAMESPACES],
    // React already escapes interpolated values, so i18next must not double-escape.
    interpolation: { escapeValue: false },
    // We drive loading ourselves and want synchronous renders in tests.
    react: { useSuspense: false },
  });

/**
 * Register translations at runtime — the extension point for the plugin system
 * (#255). A plugin can add a brand-new namespace or extend an existing one for
 * any locale; the bundle is deep-merged so it augments rather than replaces
 * bundled keys. Call once per locale/namespace the plugin ships.
 */
export function registerTranslations(
  lng: string,
  ns: string,
  resources: Record<string, unknown>,
): void {
  i18n.addResourceBundle(lng, ns, resources, true, true);
}
