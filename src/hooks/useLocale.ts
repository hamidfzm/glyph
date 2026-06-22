import { locale as osLocale } from "@tauri-apps/plugin-os";
import { useEffect } from "react";
import { i18n } from "@/lib/i18n";
import { localeDir, resolveLocale } from "@/lib/locales";

// Applies the active UI locale, mirroring useTheme: App owns this global
// side-effect, nothing below the provider boundary touches it. Resolution
// order is explicit override → OS UI language → webview language → English.
// navigator.language alone is wrong on desktop — in a Tauri webview it reflects
// the embedded browser, not the OS, so we ask plugin-os first.
export function useLocale(override: string) {
  useEffect(() => {
    let cancelled = false;

    async function apply() {
      let requested = override;
      if (override === "system") {
        let detected: string | null = null;
        try {
          detected = await osLocale();
        } catch {
          detected = null;
        }
        requested = detected ?? navigator.language;
      }
      if (cancelled) return;

      const code = resolveLocale(requested);
      await i18n.changeLanguage(code);
      if (cancelled) return;

      document.documentElement.lang = code;
      document.documentElement.dir = localeDir(code);
    }

    apply();
    return () => {
      cancelled = true;
    };
  }, [override]);
}
