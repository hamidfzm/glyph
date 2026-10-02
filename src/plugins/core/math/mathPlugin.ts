// The math core plugin: $inline$ and $$block$$ math, rendered with KaTeX. It
// reaches the app only through the public plugin API and imports nothing
// outside its own folder but the public plugin types and the remark-math,
// rehype-katex, and KaTeX packages. KaTeX and its stylesheet load only when the
// first document containing math renders.

import remarkMath from "remark-math";
import type { PluginModule } from "@/lib/plugins/types";
import styles from "./math.css?inline";
import { hasMath } from "./mathPattern";
import { loadRehypeMath } from "./rehypeMath";

const plugin: PluginModule = {
  activate(ctx) {
    ctx.ui.addStyles(styles);
    ctx.markdown.registerRemarkPlugin(remarkMath);
    ctx.markdown.registerRehypePlugin({
      detect: hasMath,
      load: async () => {
        const [rehypeMath, { default: katexStyles }] = await Promise.all([
          loadRehypeMath(),
          import("katex/dist/katex.min.css?inline"),
        ]);
        // Added after activate: if the plugin was turned off meanwhile, the
        // registration is torn down at once.
        ctx.ui.addStyles(katexStyles);
        return rehypeMath;
      },
    });
  },
};

export default plugin;
