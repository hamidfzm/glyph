// The daily notes core plugin: "Open Today's Note" in the File menu, the
// palette, and on a shortcut, with its folder, file name pattern, and template
// kept per workspace. It reaches the app only through the public plugin API
// and imports nothing outside its own folder but the public plugin types and
// React, which it renders with in a root of its own.

import { createElement } from "react";
import type { PluginModule } from "@/lib/plugins/types";
import { DailyNotesSettingsPanel } from "./DailyNotesSettingsPanel";
import de from "./locales/de.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import fa from "./locales/fa.json";
import zh from "./locales/zh.json";
import { mountReact } from "./mountReact";
import { createTodaysNoteOpener, type Translate } from "./openTodaysNote";
import { readSettings } from "./settings";

const NAMESPACE = "glyph.core.daily-notes";

const plugin: PluginModule = {
  activate(ctx) {
    for (const [locale, resources] of Object.entries({ en, de, es, fa, zh })) {
      ctx.registerTranslations(locale, NAMESPACE, resources);
    }
    const t: Translate = (key, values) => ctx.i18n.t(`${NAMESPACE}:${key}`, values);
    const openTodaysNote = createTodaysNoteOpener(ctx, t);
    const load = async () => readSettings(await ctx.workspace.getSettings());

    const contribute = () => {
      const removeCommand = ctx.commands.register({
        id: "open-today",
        title: t("command"),
        menu: "file",
        shortcut: "CmdOrCtrl+Shift+T",
        when: "workspace",
        run: openTodaysNote,
      });
      const removePanel = ctx.ui.addWorkspaceSettingsPanel({
        id: "settings",
        title: t("settings.title"),
        mount(el, registerCleanup) {
          const panel = createElement(DailyNotesSettingsPanel, {
            load,
            save: (settings) => ctx.workspace.setSettings({ ...settings }),
            t,
          });
          mountReact(el, panel, registerCleanup);
        },
      });
      return () => {
        removeCommand();
        removePanel();
      };
    };

    // The command's and the tab's titles are read when they are added, so a
    // language switch adds them again.
    let remove = contribute();
    ctx.i18n.onLanguageChange(() => {
      remove();
      remove = contribute();
    });
  },
};

export default plugin;
