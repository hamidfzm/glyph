// The backlinks core plugin: the notes linking to the open one, as a block in
// the Files panel. It reaches the app only through the public plugin API and
// imports nothing outside its own folder but the public plugin types and
// React, which it renders with in a root of its own.

import { createElement } from "react";
import type { PluginModule } from "@/lib/plugins/types";
import { BacklinksList } from "./BacklinksList";
import { createBacklinksStore } from "./backlinksStore";
import de from "./locales/de.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import fa from "./locales/fa.json";
import zh from "./locales/zh.json";
import { mountReact } from "./mountReact";

const NAMESPACE = "glyph.core.backlinks";
const MIN_HEIGHT = 80;

const plugin: PluginModule = {
  activate(ctx) {
    for (const [locale, resources] of Object.entries({ en, de, es, fa, zh })) {
      ctx.registerTranslations(locale, NAMESPACE, resources);
    }
    const t = (key: string) => ctx.i18n.t(`${NAMESPACE}:${key}`);
    const store = createBacklinksStore(ctx);

    const addPanel = () =>
      ctx.ui.addSidebarPanel({
        id: "backlinks",
        title: t("heading"),
        location: "files",
        frame: { min: MIN_HEIGHT },
        mountHeading(el, registerCleanup) {
          const count = document.createElement("span");
          count.className = "text-xs text-[var(--color-text-tertiary)]";
          const showCount = () => {
            count.textContent = String(store.get().rows.length);
          };
          showCount();
          el.append(count);
          registerCleanup(store.subscribe(showCount));
        },
        mount(el, registerCleanup) {
          const list = createElement(BacklinksList, {
            store,
            emptyLabel: t("empty"),
            onOpen: (path, line) => ctx.navigation.openFile(path, { line }),
          });
          mountReact(el, list, registerCleanup);
        },
      });

    // The panel's strings are read when it is added, so a language switch adds
    // it again.
    let removePanel = addPanel();
    ctx.i18n.onLanguageChange(() => {
      removePanel();
      removePanel = addPanel();
    });
  },
};

export default plugin;
