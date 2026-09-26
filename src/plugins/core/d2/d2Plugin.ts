// The D2 core plugin: ```d2 blocks and .d2 files. It reaches the app only
// through the public plugin API, like a community plugin would, and imports
// nothing outside its own folder but the public plugin types and the D2 and
// DOMPurify packages; no React, no app i18n.

import type { PluginModule } from "@/lib/plugins/types";
import { createD2Renderer, D2_NAMESPACE } from "./createD2Renderer";
import styles from "./d2.css?inline";
import { renderD2 } from "./d2Render";
import de from "./locales/de.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import fa from "./locales/fa.json";
import zh from "./locales/zh.json";

const plugin: PluginModule = {
  activate(ctx) {
    for (const [locale, resources] of Object.entries({ en, de, es, fa, zh })) {
      ctx.registerTranslations(locale, D2_NAMESPACE, resources);
    }
    ctx.ui.addStyles(styles);
    // Print and PDF put diagrams on white paper, so the static render is light,
    // wrapped in the same class so the plugin's layout styles still apply.
    ctx.markdown.registerFencedRenderer("d2", createD2Renderer(ctx.i18n), {
      renderStatic: async (code) => `<div class="d2-diagram">${await renderD2(code, false)}</div>`,
    });
    ctx.documents.registerFileType({ extensions: ["d2"], language: "d2" });
  },
};

export default plugin;
