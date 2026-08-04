// The mdast shapes a wikilink becomes, and the parsing that fills them in:
// `[[name|alias]]` / `[[name#heading]]` split into their parts, then built as a
// `link` node or an `embed` node carrying the data attributes LinkComponent and
// EmbedComponent read. The remark pass that swaps them into the tree lives in
// wikilink.ts.

import { resolveWikilink } from "./wikilinkResolver";

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
  workspaceFiles?: string[];
  currentFilePath?: string;
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
  const resolved = resolveWikilink(
    parsed.rawTarget,
    options.workspaceFiles ?? [],
    options.currentFilePath,
  );
  const broken = resolved.path === null;
  const display = parsed.alias ?? parsed.baseTarget;

  // hProperties uses camelCased keys (the hast/React convention). className is
  // an array per hast spec; data-* keys must match the sanitize allowlist.
  const hProperties: Record<string, string | string[]> = {
    className: broken ? ["wikilink", "wikilink--broken"] : ["wikilink"],
    dataWikilink: parsed.baseTarget,
  };
  if (!broken && resolved.path) hProperties.dataWikilinkPath = resolved.path;
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
  const resolved = resolveWikilink(
    parsed.rawTarget,
    options.workspaceFiles ?? [],
    options.currentFilePath,
  );
  const broken = resolved.path === null;

  const hProperties: Record<string, string | string[]> = {
    className: ["markdown-embed"],
    dataEmbedTarget: parsed.baseTarget,
  };
  if (!broken && resolved.path) hProperties.dataEmbedPath = resolved.path;
  if (broken) hProperties.dataEmbedBroken = "";
  if (parsed.heading) hProperties.dataEmbedHeading = parsed.heading;

  return {
    type: "embed",
    children: [],
    data: { embed: true, embedParsed: parsed, hName: "div", hProperties },
  };
}
