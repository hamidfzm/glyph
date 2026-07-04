import { defaultSchema } from "rehype-sanitize";

// Inline SVG drawing primitives that are safe to render from markdown. We keep
// out anything that can smuggle behaviour or external content: <foreignObject>
// (arbitrary HTML), <script>, <style> (CSS injection), <a>/<use href>/<image
// href> (external refs), and <animate>/<set> (attribute injection). What's left
// is static, self-contained geometry.
const svgTagNames = [
  "svg",
  "g",
  "defs",
  "title",
  "desc",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "linearGradient",
  "radialGradient",
  "stop",
  "marker",
  "symbol",
  "clipPath",
];

// Geometry + paint attributes shared by the SVG elements above. hast-util-sanitize
// matches property-information's camelCased SVG property names, so these follow
// that casing (e.g. `stroke-width` -> `strokeWidth`, `viewBox` stays `viewBox`),
// not the raw attribute spelling.
const svgCommonAttributes = [
  "id",
  "transform",
  "opacity",
  "color",
  // paint
  "fill",
  "fillOpacity",
  "fillRule",
  "clipRule",
  "clipPath",
  "stroke",
  "strokeWidth",
  "strokeLinecap",
  "strokeLinejoin",
  "strokeDasharray",
  "strokeDashoffset",
  "strokeOpacity",
  "strokeMiterlimit",
  // geometry
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "dx",
  "dy",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "fx",
  "fy",
  "width",
  "height",
  "points",
  "d",
  "offset",
  // text
  "textAnchor",
  "dominantBaseline",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "letterSpacing",
];

const svgAttributes: Record<string, string[]> = {
  svg: [
    "className",
    "viewBox",
    "preserveAspectRatio",
    "xmlns",
    "ariaHidden",
    "role",
    ...svgCommonAttributes,
  ],
  g: svgCommonAttributes,
  defs: svgCommonAttributes,
  title: [],
  desc: [],
  path: svgCommonAttributes,
  rect: svgCommonAttributes,
  circle: svgCommonAttributes,
  ellipse: svgCommonAttributes,
  line: svgCommonAttributes,
  polyline: svgCommonAttributes,
  polygon: svgCommonAttributes,
  text: svgCommonAttributes,
  tspan: svgCommonAttributes,
  linearGradient: ["gradientUnits", "gradientTransform", "spreadMethod", ...svgCommonAttributes],
  radialGradient: ["gradientUnits", "gradientTransform", "spreadMethod", ...svgCommonAttributes],
  stop: ["stopColor", "stopOpacity", ...svgCommonAttributes],
  marker: [
    "markerWidth",
    "markerHeight",
    "markerUnits",
    "refX",
    "refY",
    "orient",
    "viewBox",
    ...svgCommonAttributes,
  ],
  symbol: ["viewBox", "preserveAspectRatio", ...svgCommonAttributes],
  clipPath: ["clipPathUnits", ...svgCommonAttributes],
};

// Allowlist for raw HTML in markdown. Glyph is a local-file viewer so the
// XSS surface is small, but we still strip <script>, on* handlers, and
// javascript: URLs (defaultSchema's behaviour) and only widen the allowlist
// to the GitHub-style elements/attributes README authors actually use, plus
// static inline SVG (see `svgTagNames`).
//
// `style` is intentionally allowed: badges and centered headers in GitHub
// READMEs frequently rely on inline style. If Glyph ever loads remote
// content this needs to be revisited.
export const markdownSanitizeSchema = {
  ...defaultSchema,
  // Disable id/name namespacing. The default schema rewrites these by
  // prepending `user-content-`, but remark-gfm v4 already emits footnote
  // ids with that prefix (`user-content-fn-1`). The double-prefix breaks
  // footnote `[^1]` navigation because the href stays `#user-content-fn-1`
  // while the target id becomes `#user-content-user-content-fn-1`.
  // Glyph is a local viewer with no host-page collisions to worry about.
  clobberPrefix: "",
  clobber: [],
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    "kbd",
    "sub",
    "sup",
    "details",
    "summary",
    "video",
    "source",
    ...svgTagNames,
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
    // Note-embed placeholder emitted by remarkWikilink; EmbedComponent reads
    // these to load and render the target inline.
    div: [
      ...(defaultSchema.attributes?.div ?? []),
      "dataEmbedTarget",
      "dataEmbedPath",
      "dataEmbedHeading",
      "dataEmbedBroken",
    ],
    img: [...(defaultSchema.attributes?.img ?? []), "align", "width", "height"],
    details: [...(defaultSchema.attributes?.details ?? []), "open"],
    video: ["src", "controls", "width", "height", "poster", "loop", "muted", "autoplay"],
    source: ["src", "type"],
    ...svgAttributes,
  },
};
