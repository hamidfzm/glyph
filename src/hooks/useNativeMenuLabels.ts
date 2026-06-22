import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { i18n } from "@/lib/i18n";

// Pushes localized native-menu labels to the Rust side. The menu is built in
// Rust with English defaults; this re-labels it via `set_menu_labels` whenever
// the locale changes or a locale's (lazily loaded) `menu` bundle arrives. The
// `menu` namespace is a flat map matching the Rust `MenuLabels` struct; English
// is merged underneath the active locale so any missing key falls back.
export function useNativeMenuLabels() {
  useEffect(() => {
    const push = () => {
      const en = (i18n.getResourceBundle("en", "menu") ?? {}) as Record<string, string>;
      const active = (i18n.getResourceBundle(i18n.language, "menu") ?? {}) as Record<
        string,
        string
      >;
      invoke("set_menu_labels", { labels: { ...en, ...active } }).catch((err) => {
        console.error("Failed to localize native menu:", err);
      });
    };

    push();
    i18n.on("languageChanged", push);
    i18n.on("loaded", push);
    return () => {
      i18n.off("languageChanged", push);
      i18n.off("loaded", push);
    };
  }, []);
}
