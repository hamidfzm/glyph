import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { i18n } from "@/lib/i18n";
import { isMobilePlatform } from "@/lib/platform";

// Pushes localized native-menu labels to the Rust side. The menu is built in
// Rust with English defaults; this re-labels it via `set_menu_labels` whenever
// the locale changes or a locale's (lazily loaded) `menu` bundle arrives. The
// `menu` namespace is a flat map matching the Rust `MenuLabels` struct; English
// is merged underneath the active locale so any missing key falls back.
export function useNativeMenuLabels() {
  useEffect(() => {
    // No native menu (or set_menu_labels command) exists on mobile.
    if (isMobilePlatform()) return;
    const push = async () => {
      // Nothing else mounts useTranslation("menu"), so the active locale's menu
      // bundle isn't pulled in by render; load it explicitly before reading.
      await i18n.loadNamespaces("menu");
      const en = (i18n.getResourceBundle("en", "menu") ?? {}) as Record<string, string>;
      const active = (i18n.getResourceBundle(i18n.language, "menu") ?? {}) as Record<
        string,
        string
      >;
      try {
        await invoke("set_menu_labels", { labels: { ...en, ...active } });
      } catch (err) {
        console.error("Failed to localize native menu:", err);
      }
    };

    const run = () => void push();
    run();
    i18n.on("languageChanged", run);
    return () => {
      i18n.off("languageChanged", run);
    };
  }, []);
}
