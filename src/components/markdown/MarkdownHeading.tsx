import type { ComponentPropsWithoutRef } from "react";
import { HeadingAnchor } from "./HeadingAnchor";

type HeadingTag = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

interface MarkdownHeadingProps extends ComponentPropsWithoutRef<HeadingTag> {
  // ReactMarkdown passes the source hast node; we read its tagName to render the
  // matching heading level with a single component for h1-h6.
  node?: { tagName?: string };
}

const HEADING_TAGS = new Set<HeadingTag>(["h1", "h2", "h3", "h4", "h5", "h6"]);

/**
 * Heading renderer for the markdown viewer. Renders the level matching the
 * source node and, when the heading has an id (assigned by rehype-slug), appends
 * a hover-revealed anchor-copy button. Headings without an id render plain.
 */
export function MarkdownHeading({ node, id, children, ...rest }: MarkdownHeadingProps) {
  const tagName = node?.tagName;
  const Tag: HeadingTag =
    tagName && HEADING_TAGS.has(tagName as HeadingTag) ? (tagName as HeadingTag) : "h1";

  return (
    <Tag id={id} {...rest}>
      {children}
      {id && <HeadingAnchor id={id} />}
    </Tag>
  );
}
