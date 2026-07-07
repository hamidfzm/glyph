// A small remark plugin that turns `[[name]]`, `[[name|alias]]`, and
// `[[name#heading]]` text into clickable links, and `![[name]]` /
// `![[name#heading]]` into inline note embeds, resolved against the active
// folder workspace. We scan text nodes after remark has parsed the document and
// replace matches with `link` (or embed) mdast nodes carrying data attributes
// the LinkComponent / EmbedComponent use to drive navigation and rendering.
// This loses the (rare) case where a `[ref]` link reference is defined that
// overlaps with a `[[wikilink]]`, but avoids a much heavier micromark extension
// and the maintenance cost.
//
// Embeds are block-level, but the scan runs on text inside a paragraph. So a
// second pass hoists a paragraph whose only content is embeds up to block
// level and drops the wrapping `<p>`; an embed that shares its paragraph with
// other text falls back to a plain (navigable) wikilink, since a block can't
// nest inside a paragraph.
import type { Plugin } from "unified";
import { visit } from "unist-util-visit";
import { isImageFile } from "./imageExtensions";
import { resolveWikilink } from "./wikilinkResolver";

interface Node {
  type: string;
  data?: { embed?: boolean; embedParsed?: ParsedWikilink; [key: string]: unknown };
  [key: string]: unknown;
}
interface Parent extends Node {
  children: Node[];
}

// Optional leading `!` switches a wikilink into an embed.
const WIKILINK_RE = /(!?)\[\[([^\]\n]+?)\]\]/g;

export interface WikilinkPluginOptions {
  workspaceFiles?: string[];
  currentFilePath?: string;
}

interface ParsedWikilink {
  rawTarget: string;
  baseTarget: string;
  heading?: string;
  alias?: string;
}

interface TextNode extends Node {
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

function parseInner(raw: string): ParsedWikilink {
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

function buildLinkNode(parsed: ParsedWikilink, options: WikilinkPluginOptions): LinkNode {
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

function buildEmbedNode(parsed: ParsedWikilink, options: WikilinkPluginOptions): EmbedNode {
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

const remarkWikilink: Plugin<[WikilinkPluginOptions?]> =
  (options = {}) =>
  (tree) => {
    const root = tree as unknown as Parameters<typeof visit>[0];

    // Pass 1: replace `[[...]]` / `![[...]]` inside text nodes. A matched text
    // node is never the tree root, so `parent` and `index` are always set;
    // assert them rather than guard so there is no unreachable branch.
    visit(root, "text", (node: TextNode, index: number | null, parent: Parent | null) => {
      const parentNode = parent as Parent;
      const at = index as number;
      // Skip text inside inline code, code blocks, links, etc.
      if (
        parentNode.type === "inlineCode" ||
        parentNode.type === "code" ||
        parentNode.type === "link"
      ) {
        return;
      }

      const value = node.value;
      WIKILINK_RE.lastIndex = 0;
      if (!WIKILINK_RE.test(value)) return;

      WIKILINK_RE.lastIndex = 0;
      const replacement: Node[] = [];
      let cursor = 0;
      let match: RegExpExecArray | null = WIKILINK_RE.exec(value);
      while (match !== null) {
        const [whole, bang, inner] = match;
        if (match.index > cursor) {
          replacement.push({ type: "text", value: value.slice(cursor, match.index) } as TextNode);
        }
        const parsed = parseInner(inner);
        // `![[image.png]]` keeps its plain-text `!` plus a (broken) wikilink, so
        // image embeds are unchanged. Only `![[note]]` becomes an embed node, and
        // only directly inside a paragraph: an embed nested in inline markup
        // (`**![[note]]**`) can't be hoisted to a block, so it stays a wikilink.
        if (bang && !isImageFile(parsed.baseTarget) && parentNode.type === "paragraph") {
          replacement.push(buildEmbedNode(parsed, options));
        } else {
          if (bang) replacement.push({ type: "text", value: "!" } as TextNode);
          replacement.push(buildLinkNode(parsed, options));
        }
        cursor = match.index + whole.length;
        match = WIKILINK_RE.exec(value);
      }
      if (cursor < value.length) {
        replacement.push({ type: "text", value: value.slice(cursor) } as TextNode);
      }

      parentNode.children.splice(at, 1, ...replacement);
      return at + replacement.length;
    });

    // Pass 2: normalize embeds sitting inside a paragraph. A paragraph made up
    // solely of embeds (plus whitespace) is replaced by those embeds at block
    // level; a paragraph that mixes an embed with other content downgrades the
    // embed to a plain wikilink so nothing nests a block inside a `<p>`.
    visit(root, "paragraph", (node: Parent, index: number | null, parent: Parent | null) => {
      const embeds = node.children.filter((c) => c.data?.embed);
      if (embeds.length === 0) return;

      const standalone = node.children.every(
        (c) => c.data?.embed || (c.type === "text" && (c.value as string).trim() === ""),
      );

      if (standalone) {
        // A paragraph always has a parent and numeric index (never the root).
        const parentNode = parent as Parent;
        const at = index as number;
        parentNode.children.splice(at, 1, ...embeds);
        return at + embeds.length;
      }

      // Mixed content: swap each embed node in place for its wikilink form.
      node.children = node.children.map((c) =>
        c.data?.embed ? buildLinkNode(c.data.embedParsed as ParsedWikilink, options) : c,
      );
    });
  };

export { remarkWikilink };
