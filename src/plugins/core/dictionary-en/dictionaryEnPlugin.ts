// The English spell-check dictionary core plugin: US English from SCOWL (see
// LICENSE), offered through the public dictionary API like any community
// dictionary. Its text is a lazy chunk, fetched only once English is checked.

import type { PluginModule } from "@/lib/plugins/types";

const plugin: PluginModule = {
  activate(ctx) {
    ctx.spellcheck.registerDictionary({
      language: "en",
      label: "English (US)",
      load: async () => {
        const [aff, dic] = await Promise.all([import("./en.aff?raw"), import("./en.dic?raw")]);
        return { aff: aff.default, dic: dic.default };
      },
    });
  },
};

export default plugin;
