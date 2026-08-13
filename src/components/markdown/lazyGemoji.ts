import type { Options } from "react-markdown";
import { trackPluginLoad } from "@/lib/markdown/pluginLoads";

type RemarkPlugin = NonNullable<Options["remarkPlugins"]>[number];

// Cheap detector: a false positive (e.g. "10:30:45") just means the gemoji
// data loads when it didn't have to, not a correctness problem. The shortcode
// alphabet is letters, digits, underscore, plus, and minus (:+1:, :-1:).
const EMOJI_SHORTCODE_PATTERN = /:[-+\w]+:/;

let gemojiPromise: Promise<RemarkPlugin> | null = null;

export function hasEmojiShortcode(content: string): boolean {
  return EMOJI_SHORTCODE_PATTERN.test(content);
}

// remark-gemoji bundles the full shortcode-to-emoji table, which is heavy, so
// it stays out of the startup chunk and loads on first sight of a shortcode.
export function loadGemoji(): Promise<RemarkPlugin> {
  if (!gemojiPromise) {
    gemojiPromise = trackPluginLoad(
      import("remark-gemoji").then((mod) => mod.default as RemarkPlugin),
    );
  }
  return gemojiPromise;
}
