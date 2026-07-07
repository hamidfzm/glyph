import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { describe, expect, it } from "vitest";
import { markdownSanitizeSchema } from "../components/markdown/sanitizeSchema";
import { remarkWikilink, type WikilinkPluginOptions } from "./wikilink";

interface Node {
  type: string;
  [key: string]: unknown;
}
interface Parent extends Node {
  children: Node[];
}

interface LinkNode extends Node {
  type: "link";
  url: string;
  children: Array<{ type: "text"; value: string }>;
  data?: { hName?: string; hProperties?: Record<string, string> };
}

function findWikilinks(md: string, options: WikilinkPluginOptions = {}): LinkNode[] {
  const tree = unified().use(remarkParse).use(remarkWikilink, options).parse(md);
  // Run transformers (remarkWikilink runs in this phase).
  const transformed = unified().use(remarkWikilink, options).runSync(tree);
  const out: LinkNode[] = [];
  visit(transformed as Node, "link", (node: LinkNode) => {
    if (node.data?.hProperties?.dataWikilink !== undefined) out.push(node);
  });
  return out;
}

function rawValueAt(md: string, options: WikilinkPluginOptions = {}, type: string): string[] {
  const tree = unified()
    .use(remarkParse)
    .use(remarkWikilink, options)
    .runSync(unified().use(remarkParse).parse(md)) as Parent;
  const values: string[] = [];
  visit(tree as Node, type, (n: Node & { value?: string }) => {
    if (typeof n.value === "string") values.push(n.value);
  });
  return values;
}

describe("remarkWikilink", () => {
  const files = ["/workspace/Index.md", "/workspace/Notes/Cooking.md"];

  it("decorates a resolved wikilink with data attributes", () => {
    const [node] = findWikilinks("See [[Cooking]] now.", { workspaceFiles: files });
    expect(node).toBeDefined();
    expect(node.data?.hProperties).toMatchObject({
      dataWikilink: "Cooking",
      dataWikilinkPath: "/workspace/Notes/Cooking.md",
      className: ["wikilink"],
    });
    expect(node.data?.hProperties).not.toHaveProperty("dataWikilinkBroken");
    expect(node.children[0].value).toBe("Cooking");
    expect(node.url).toBe("#");
  });

  it("flags a missing target as broken", () => {
    const [node] = findWikilinks("See [[Missing]].", { workspaceFiles: files });
    expect(node.data?.hProperties).toMatchObject({
      dataWikilink: "Missing",
      dataWikilinkBroken: "",
      className: ["wikilink", "wikilink--broken"],
    });
    expect(node.data?.hProperties).not.toHaveProperty("dataWikilinkPath");
  });

  it("uses the alias as display text", () => {
    const [node] = findWikilinks("[[Cooking|kitchen notes]]", { workspaceFiles: files });
    expect(node.children[0].value).toBe("kitchen notes");
    expect(node.data?.hProperties?.dataWikilink).toBe("Cooking");
  });

  it("captures the heading", () => {
    const [node] = findWikilinks("[[Cooking#Recipes]]", { workspaceFiles: files });
    expect(node.data?.hProperties).toMatchObject({
      dataWikilink: "Cooking",
      dataWikilinkHeading: "Recipes",
      dataWikilinkPath: "/workspace/Notes/Cooking.md",
    });
  });

  it("strips a `.md` extension from the target during resolution", () => {
    const [node] = findWikilinks("[[Cooking.md]]", { workspaceFiles: files });
    expect(node.data?.hProperties?.dataWikilinkPath).toBe("/workspace/Notes/Cooking.md");
  });

  it("treats every link as broken without a workspace", () => {
    const [node] = findWikilinks("[[Cooking]]");
    expect(node.data?.hProperties).toHaveProperty("dataWikilinkBroken");
    expect(node.data?.hProperties).not.toHaveProperty("dataWikilinkPath");
  });

  it("ignores wikilinks inside fenced code blocks", () => {
    const nodes = findWikilinks("```\n[[Cooking]]\n```", { workspaceFiles: files });
    expect(nodes).toHaveLength(0);
  });

  it("ignores wikilinks inside inline code", () => {
    const nodes = findWikilinks("Use `[[Cooking]]` to link.", { workspaceFiles: files });
    expect(nodes).toHaveLength(0);
  });

  it("decorates multiple wikilinks in the same paragraph", () => {
    const nodes = findWikilinks("[[Index]] and [[Cooking]]", { workspaceFiles: files });
    expect(nodes.map((n) => n.data?.hProperties?.dataWikilink)).toEqual(["Index", "Cooking"]);
  });

  it("preserves surrounding text", () => {
    expect(rawValueAt("before [[Index]] after", { workspaceFiles: files }, "text")).toEqual([
      "before ",
      "Index",
      " after",
    ]);
  });

  it("never produces a non-anchor href", () => {
    const [node] = findWikilinks("[[Cooking]]", { workspaceFiles: files });
    expect(node.url).toBe("#");
  });
});

describe("remarkWikilink with rehype-sanitize", () => {
  async function html(md: string, options: WikilinkPluginOptions) {
    const file = await unified()
      .use(remarkParse)
      .use(remarkWikilink, options)
      .use(remarkRehype, { allowDangerousHtml: true })
      .use(rehypeRaw)
      .use(rehypeSanitize, markdownSanitizeSchema)
      .use(rehypeStringify)
      .process(md);
    return String(file);
  }

  it("preserves className and data attributes through sanitize", async () => {
    const out = await html("[[Cooking]]", { workspaceFiles: ["/workspace/Cooking.md"] });
    expect(out).toContain('class="wikilink"');
    expect(out).toContain('data-wikilink="Cooking"');
    expect(out).toContain('data-wikilink-path="/workspace/Cooking.md"');
  });

  it("preserves the broken modifier and marker", async () => {
    const out = await html("[[Missing]]", { workspaceFiles: ["/workspace/Cooking.md"] });
    expect(out).toContain("wikilink--broken");
    expect(out).toContain("data-wikilink-broken");
    expect(out).not.toContain("data-wikilink-path");
  });
});

describe("remarkWikilink embeds", () => {
  const files = ["/workspace/Notes/Cooking.md"];

  async function html(md: string, options: WikilinkPluginOptions) {
    const file = await unified()
      .use(remarkParse)
      .use(remarkWikilink, options)
      .use(remarkRehype, { allowDangerousHtml: true })
      .use(rehypeRaw)
      .use(rehypeSanitize, markdownSanitizeSchema)
      .use(rehypeStringify)
      .process(md);
    return String(file);
  }

  it("renders a standalone embed as a block div with the resolved path", async () => {
    const out = await html("![[Cooking]]", { workspaceFiles: files });
    expect(out).toContain('class="markdown-embed"');
    expect(out).toContain('data-embed-path="/workspace/Notes/Cooking.md"');
    // Hoisted out of the paragraph, so the embed is not wrapped in a <p>.
    expect(out).not.toContain("<p>");
  });

  it("carries the heading on an embed", async () => {
    const out = await html("![[Cooking#Recipes]]", { workspaceFiles: files });
    expect(out).toContain('data-embed-heading="Recipes"');
  });

  it("marks an unresolved embed as broken", async () => {
    const out = await html("![[Missing]]", { workspaceFiles: files });
    expect(out).toContain('class="markdown-embed"');
    expect(out).toContain("data-embed-broken");
    expect(out).not.toContain("data-embed-path");
  });

  it("marks an embed as broken when no workspace is open", async () => {
    // Exercises the `workspaceFiles ?? []` default in the embed builder.
    const out = await html("![[Cooking]]", {});
    expect(out).toContain('class="markdown-embed"');
    expect(out).toContain("data-embed-broken");
  });

  it("leaves image embeds as a literal ! plus wikilink", async () => {
    const out = await html("![[photo.png]]", { workspaceFiles: files });
    expect(out).not.toContain("markdown-embed");
    expect(out).toContain("!");
    expect(out).toContain('class="wikilink');
  });

  it("downgrades a mid-sentence embed to a plain wikilink", async () => {
    const out = await html("see ![[Cooking]] now", { workspaceFiles: files });
    expect(out).not.toContain("markdown-embed");
    expect(out).toContain('data-wikilink-path="/workspace/Notes/Cooking.md"');
  });

  it("hoists several stacked embeds to sibling blocks", async () => {
    const out = await html("![[Cooking]]\n![[Missing]]", { workspaceFiles: files });
    expect(out.match(/class="markdown-embed"/g) ?? []).toHaveLength(2);
  });

  it("downgrades an embed nested in inline markup to a wikilink", async () => {
    // An embed inside bold can't be hoisted to a block, so it stays a wikilink
    // instead of producing mangled block-in-inline markup.
    const out = await html("**![[Cooking]]**", { workspaceFiles: files });
    expect(out).not.toContain("markdown-embed");
    expect(out).toContain("<strong>");
    expect(out).toContain('data-wikilink-path="/workspace/Notes/Cooking.md"');
  });
});
