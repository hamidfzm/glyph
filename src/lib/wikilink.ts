// A small remark plugin that turns `[[name]]`, `[[name|alias]]`, and
// `[[name#heading]]` text into clickable links resolved against the active
// folder workspace. We scan text nodes after remark has parsed the document
// and replace matches with `link` mdast nodes carrying data attributes the
// LinkComponent uses to drive navigation. This loses the (rare) case where a
// `[ref]` link reference is defined that overlaps with a `[[wikilink]]`, but
// avoids a much heavier micromark extension and the maintenance cost.
import type { Plugin } from "unified";
import { visit } from "unist-util-visit";
import { resolveWikilink } from "./wikilinkResolver";

interface Node {
  type: string;
  [key: string]: unknown;
}
interface Parent extends Node {
  children: Node[];
}

const WIKILINK_RE = /\[\[([^\]\n]+?)\]\]/g;

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

const remarkWikilink: Plugin<[WikilinkPluginOptions?]> =
  (options = {}) =>
  (tree) => {
    visit(
      tree as unknown as Parameters<typeof visit>[0],
      "text",
      (node: TextNode, index: number | null, parent: Parent | null) => {
        if (!parent || index === null) return;
        // Skip text inside inline code, code blocks, links, etc.
        if (parent.type === "inlineCode" || parent.type === "code" || parent.type === "link") {
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
          const [whole, inner] = match;
          if (match.index > cursor) {
            replacement.push({ type: "text", value: value.slice(cursor, match.index) } as TextNode);
          }
          replacement.push(buildLinkNode(parseInner(inner), options));
          cursor = match.index + whole.length;
          match = WIKILINK_RE.exec(value);
        }
        if (cursor < value.length) {
          replacement.push({ type: "text", value: value.slice(cursor) } as TextNode);
        }

        parent.children.splice(index, 1, ...replacement);
        return index + replacement.length;
      },
    );
  };

export { remarkWikilink };
