import { defaultSchema } from "rehype-sanitize";

// Allowlist for raw HTML in markdown. Glyph is a local-file viewer so the
// XSS surface is small, but we still strip <script>, on* handlers, and
// javascript: URLs (defaultSchema's behaviour) and only widen the allowlist
// to the GitHub-style elements/attributes README authors actually use.
//
// `style` is intentionally allowed: badges and centered headers in GitHub
// READMEs frequently rely on inline style. If Glyph ever loads remote
// content this needs to be revisited.
export const markdownSanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    "kbd",
    "sub",
    "sup",
    "details",
    "summary",
    "video",
    "source",
    "svg",
    "path",
  ],
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "align", "style", "className", "dir"],
    // Plain `className` (first entry wins in hast-util-sanitize) overrides the
    // default `[className, data-footnote-backref]` allowlist so wikilink
    // classes survive sanitization.
    a: [
      "className",
      ...(defaultSchema.attributes?.a ?? []),
      "dataWikilink",
      "dataWikilinkPath",
      "dataWikilinkHeading",
      "dataWikilinkBroken",
    ],
    img: [...(defaultSchema.attributes?.img ?? []), "align", "width", "height"],
    details: [...(defaultSchema.attributes?.details ?? []), "open"],
    video: ["src", "controls", "width", "height", "poster", "loop", "muted", "autoplay"],
    source: ["src", "type"],
    svg: ["className", "viewBox", "width", "height", "ariaHidden", "fill"],
    path: ["d", "fillRule", "clipRule"],
  },
};
