import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { FALLBACK_LOCALE } from "@/lib/locales";
import enCommon from "@/locales/en/common.json";
import enSettings from "@/locales/en/settings.json";

// The shared i18next instance. English is bundled inline as the fallback;
// additional locales are registered here as they land (and can move to lazy
// loading once the bundle list grows). useLocale switches the active language
// at runtime — this module only sets up the default English baseline.
export const NAMESPACES = ["common", "settings"] as const;

export const i18n = i18next;

i18n.use(initReactI18next).init({
  resources: {
    en: { common: enCommon, settings: enSettings },
  },
  lng: FALLBACK_LOCALE,
  fallbackLng: FALLBACK_LOCALE,
  defaultNS: "common",
  ns: NAMESPACES,
  // React already escapes interpolated values, so i18next must not double-escape.
  interpolation: { escapeValue: false },
  // We drive loading ourselves and want synchronous renders in tests.
  react: { useSuspense: false },
});
