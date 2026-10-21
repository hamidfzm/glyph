// The theme presets core plugin: ready-made color schemes that restyle the
// whole app, each with a light and a dark variant, picked under the plugin's
// row in Settings. It reaches the app only through the public plugin API and
// imports nothing outside its own folder but the public plugin types.

import type { Disposer, PluginModule } from "@/lib/plugins/types";
import de from "./locales/de.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import fa from "./locales/fa.json";
import zh from "./locales/zh.json";
import { mountPresetPicker } from "./mountPresetPicker";
import { PRESET_CSS, type PresetId, readPreset } from "./presets";

const NAMESPACE = "glyph.core.theme-presets";
const SETTING = "preset";

const plugin: PluginModule = {
  activate(ctx) {
    for (const [locale, resources] of Object.entries({ en, de, es, fa, zh })) {
      ctx.registerTranslations(locale, NAMESPACE, resources);
    }
    const t = (key: string) => ctx.i18n.t(`${NAMESPACE}:${key}`);

    let removeStyles: Disposer | null = null;
    const apply = (preset: PresetId) => {
      removeStyles?.();
      removeStyles = preset === "none" ? null : ctx.ui.addStyles(PRESET_CSS[preset]);
    };
    apply(readPreset(ctx.settings.get(SETTING)));

    // Strings are read on every mount, and the Plugins tab remounts the panel
    // after a language switch, so there is nothing to refresh.
    ctx.ui.addSettingsPanel({
      id: "preset",
      mount(el) {
        mountPresetPicker(el, {
          value: readPreset(ctx.settings.get(SETTING)),
          label: t("label"),
          optionLabel: (preset) => t(`presets.${preset}`),
          onChange(preset) {
            ctx.settings.set(SETTING, preset);
            apply(preset);
          },
        });
      },
    });
  },
};

export default plugin;
