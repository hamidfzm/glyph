// The mdast shapes a wikilink becomes, and the parsing that fills them in:
// `[[name|alias]]` / `[[name#heading]]` split into their parts, then built as a
// `link` node or an `embed` node carrying the data attributes LinkComponent and
// EmbedComponent read. The remark pass that swaps them into the tree lives in
// wikilink.ts.

export interface Node {
  type: string;
  data?: { embed?: boolean; embedParsed?: ParsedWikilink; [key: string]: unknown };
  [key: string]: unknown;
}
export interface Parent extends Node {
  children: Node[];
}

// Optional leading `!` switches a wikilink into an embed.
export const WIKILINK_RE = /(!?)\[\[([^\]\n]+?)\]\]/g;

export interface WikilinkPluginOptions {
  /**
   * Where each raw target resolves, keyed as written (heading kept, alias
   * stripped). Absent or missing means the link renders as broken, which is
   * also what a document rendered outside a workspace gets.
   */
  resolutions?: ReadonlyMap<string, string | null>;
  /**
   * The index has not answered for this document yet. Links render plain
   * rather than broken for that one frame: resolution is a round trip now, and
   * flashing every link broken on each open and tab switch reads as breakage
   * rather than as loading.
   */
  pending?: boolean;
}

export interface ParsedWikilink {
  rawTarget: string;
  baseTarget: string;
  heading?: string;
  alias?: string;
}

export interface TextNode extends Node {
  type: "text";
  value: string;
}

interface LinkNode extends Node {
  type: "link";
  url: string;
  title?: null;
  children: TextNode[];
  data: {
    hName: "a";
    hProperties: Record<string, string | string[]>;
  };
}

interface EmbedNode extends Node {
  type: "embed";
  children: [];
  data: {
    embed: true;
    embedParsed: ParsedWikilink;
    hName: "div";
    hProperties: Record<string, string | string[]>;
  };
}

export function parseInner(raw: string): ParsedWikilink {
  const pipe = raw.indexOf("|");
  const targetWithHeading = (pipe >= 0 ? raw.slice(0, pipe) : raw).trim();
  const alias = pipe >= 0 ? raw.slice(pipe + 1).trim() : "";
  const hash = targetWithHeading.indexOf("#");
  const baseTarget = hash >= 0 ? targetWithHeading.slice(0, hash) : targetWithHeading;
  const heading = hash >= 0 ? targetWithHeading.slice(hash + 1).trim() : "";
  return {
    rawTarget: targetWithHeading,
    baseTarget: baseTarget.trim(),
    heading: heading || undefined,
    alias: alias || undefined,
  };
}

export function buildLinkNode(parsed: ParsedWikilink, options: WikilinkPluginOptions): LinkNode {
  const path = options.resolutions?.get(parsed.rawTarget) ?? null;
  const broken = path === null && !options.pending;
  const display = parsed.alias ?? parsed.baseTarget;

  // hProperties uses camelCased keys (the hast/React convention). className is
  // an array per hast spec; data-* keys must match the sanitize allowlist.
  const hProperties: Record<string, string | string[]> = {
    className: broken ? ["wikilink", "wikilink--broken"] : ["wikilink"],
    dataWikilink: parsed.baseTarget,
  };
  if (path) hProperties.dataWikilinkPath = path;
  if (broken) hProperties.dataWikilinkBroken = "";
  if (parsed.heading) hProperties.dataWikilinkHeading = parsed.heading;

  return {
    type: "link",
    url: "#",
    title: null,
    children: [{ type: "text", value: display }],
    data: { hName: "a", hProperties },
  };
}

export function buildEmbedNode(parsed: ParsedWikilink, options: WikilinkPluginOptions): EmbedNode {
  const path = options.resolutions?.get(parsed.rawTarget) ?? null;
  const broken = path === null && !options.pending;

  const hProperties: Record<string, string | string[]> = {
    className: ["markdown-embed"],
    dataEmbedTarget: parsed.baseTarget,
  };
  if (path) hProperties.dataEmbedPath = path;
  if (broken) hProperties.dataEmbedBroken = "";
  // An embed has a body to fill, so unlike a link it needs to say which of the
  // two pathless states it is in.
  if (path === null && options.pending) hProperties.dataEmbedPending = "";
  if (parsed.heading) hProperties.dataEmbedHeading = parsed.heading;

  return {
    type: "embed",
    children: [],
    data: { embed: true, embedParsed: parsed, hName: "div", hProperties },
  };
}

/** A target that names a location ("folder/note") rather than a bare note name. */
export function isNestedTarget(target: string): boolean {
  return target.includes("/") || target.includes("\\");
}

/**
 * Every wikilink target in `content`, as written and deduplicated: what the
 * index is asked to resolve before the document renders.
 */
export function wikilinkTargets(content: string): string[] {
  const targets = new Set<string>();
  WIKILINK_RE.lastIndex = 0;
  let match: RegExpExecArray | null = WIKILINK_RE.exec(content);
  while (match) {
    targets.add(parseInner(match[2]).rawTarget);
    match = WIKILINK_RE.exec(content);
  }
  return [...targets];
}
