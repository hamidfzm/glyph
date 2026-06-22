import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { FALLBACK_LOCALE } from "@/lib/locales";
import enAi from "@/locales/en/ai.json";
import enCommands from "@/locales/en/commands.json";
import enCommon from "@/locales/en/common.json";
import enSettings from "@/locales/en/settings.json";
import enSync from "@/locales/en/sync.json";
import enWorkspace from "@/locales/en/workspace.json";
import faAi from "@/locales/fa/ai.json";
import faCommands from "@/locales/fa/commands.json";
import faCommon from "@/locales/fa/common.json";
import faSettings from "@/locales/fa/settings.json";
import faSync from "@/locales/fa/sync.json";
import faWorkspace from "@/locales/fa/workspace.json";

// The shared i18next instance. English is bundled inline as the fallback;
// additional locales are registered here as they land (and can move to lazy
// loading once the bundle list grows). useLocale switches the active language
// at runtime — this module only sets up the default English baseline.
export const i18n = i18next;

i18n.use(initReactI18next).init({
  resources: {
    en: {
      common: enCommon,
      settings: enSettings,
      commands: enCommands,
      ai: enAi,
      sync: enSync,
      workspace: enWorkspace,
    },
    fa: {
      common: faCommon,
      settings: faSettings,
      commands: faCommands,
      ai: faAi,
      sync: faSync,
      workspace: faWorkspace,
    },
  },
  lng: FALLBACK_LOCALE,
  fallbackLng: FALLBACK_LOCALE,
  defaultNS: "common",
  ns: ["common", "settings", "commands", "ai", "sync", "workspace"],
  // React already escapes interpolated values, so i18next must not double-escape.
  interpolation: { escapeValue: false },
  // We drive loading ourselves and want synchronous renders in tests.
  react: { useSuspense: false },
});
