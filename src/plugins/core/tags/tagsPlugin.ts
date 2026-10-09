// The tags core plugin: the workspace's tags as a block in the Files panel,
// where picking one filters the file list. It reaches the app only through the
// public plugin API and imports nothing outside its own folder but the public
// plugin types and React, which it renders with in roots of its own.

import { createElement } from "react";
import type { PluginModule } from "@/lib/plugins/types";
import de from "./locales/de.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import fa from "./locales/fa.json";
import zh from "./locales/zh.json";
import { mountReact } from "./mountReact";
import { TagsHeading } from "./TagsHeading";
import { TagsPanel } from "./TagsPanel";
import styles from "./tags.css?inline";
import { createTagsStore } from "./tagsStore";

const NAMESPACE = "glyph.core.tags";
const MIN_HEIGHT = 56;
// Height the tag cloud grows to on its own before scrolling, until the user
// drags the divider.
const NATURAL_MAX_HEIGHT = 160;

const plugin: PluginModule = {
  activate(ctx) {
    for (const [locale, resources] of Object.entries({ en, de, es, fa, zh })) {
      ctx.registerTranslations(locale, NAMESPACE, resources);
    }
    const t = (key: string, values?: Record<string, unknown>) =>
      ctx.i18n.t(`${NAMESPACE}:${key}`, values);
    ctx.ui.addStyles(styles);
    const store = createTagsStore(ctx, (tag, total) => t("filtered", { tag, total }));

    const addPanel = () =>
      ctx.ui.addSidebarPanel({
        id: "tags",
        title: t("heading"),
        location: "files",
        frame: { min: MIN_HEIGHT, naturalMax: NATURAL_MAX_HEIGHT },
        mountHeading(el, registerCleanup) {
          const heading = createElement(TagsHeading, { store, sortLabel: t("sortByCount") });
          mountReact(el, heading, registerCleanup);
        },
        mount(el, registerCleanup) {
          const panel = createElement(TagsPanel, {
            store,
            emptyLabel: t("empty"),
            filterLabel: (tag) => t("filterBy", { tag }),
          });
          mountReact(el, panel, registerCleanup);
        },
      });

    // The panel's strings are read when it is added, so a language switch adds
    // it again, and the store redraws the filter's label.
    let removePanel = addPanel();
    ctx.i18n.onLanguageChange(() => {
      removePanel();
      removePanel = addPanel();
      store.refresh();
    });
  },
};

export default plugin;
