// The Mermaid core plugin: ```mermaid blocks, including the ones the app wraps
// around `.mmd` diagram sources. It reaches the app only through the public
// plugin API, like a community plugin would, and imports nothing outside its
// own folder but the public plugin types and the Mermaid and DOMPurify
// packages; no React, no app i18n.

import type { PluginModule } from "@/lib/plugins/types";
import { createMermaidRenderer, MERMAID_NAMESPACE } from "./createMermaidRenderer";
import de from "./locales/de.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import fa from "./locales/fa.json";
import zh from "./locales/zh.json";
import styles from "./mermaid.css?inline";
import { renderMermaidStatic } from "./mermaidRender";

const plugin: PluginModule = {
  activate(ctx) {
    for (const [locale, resources] of Object.entries({ en, de, es, fa, zh })) {
      ctx.registerTranslations(locale, MERMAID_NAMESPACE, resources);
    }
    ctx.ui.addStyles(styles);
    // Print, PDF, and site export put diagrams on white paper, so the static
    // render is light, wrapped in the same class so the plugin's layout styles
    // still apply.
    ctx.markdown.registerFencedRenderer("mermaid", createMermaidRenderer(ctx.i18n), {
      renderStatic: async (code) =>
        `<div class="mermaid-diagram">${await renderMermaidStatic(code)}</div>`,
    });
  },
};

export default plugin;
