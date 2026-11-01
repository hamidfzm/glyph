// The theme presets core plugin: ready-made color schemes that restyle the
// whole app, each with a light and a dark variant, offered in the Settings >
// Appearance picker. It reaches the app only through the public plugin API and
// imports nothing outside its own folder but the public plugin types.

import type { Disposer, PluginModule } from "@/lib/plugins/types";
import de from "./locales/de.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import fa from "./locales/fa.json";
import zh from "./locales/zh.json";
import { PRESET_CSS } from "./presets";

const NAMESPACE = "glyph.core.theme-presets";

const plugin: PluginModule = {
  activate(ctx) {
    for (const [locale, resources] of Object.entries({ en, de, es, fa, zh })) {
      ctx.registerTranslations(locale, NAMESPACE, resources);
    }

    let removeSchemes: Disposer[] = [];
    // The picker names schemes by the label they were registered with, so a
    // language switch registers them again. The new ones go in before the old
    // ones leave, which keeps the picked scheme applied throughout.
    const registerSchemes = () => {
      const previous = removeSchemes;
      removeSchemes = Object.entries(PRESET_CSS).map(([id, css]) =>
        ctx.ui.addColorScheme({ id, label: ctx.i18n.t(`${NAMESPACE}:presets.${id}`), css }),
      );
      for (const remove of previous) remove();
    };
    registerSchemes();
    ctx.i18n.onLanguageChange(registerSchemes);
  },
};

export default plugin;
