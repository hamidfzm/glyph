import rehypeParse from "rehype-parse";
import rehypeRemark from "rehype-remark";
import remarkGfm from "remark-gfm";
import remarkStringify from "remark-stringify";
import { unified } from "unified";

// Fragment parsing so a bare `<b>x</b>` from the clipboard doesn't get wrapped
// in html/head/body. GFM is on the stringify side too, so tables, task lists and
// strikethrough survive the round trip.
const processor = unified()
  .use(rehypeParse, { fragment: true })
  .use(rehypeRemark)
  .use(remarkGfm)
  .use(remarkStringify, { bullet: "-", fences: true, rule: "-" })
  .freeze();

/** Convert an HTML fragment to Markdown. Returns "" when it holds no content. */
export function htmlToMarkdown(html: string): string {
  return String(processor.processSync(html)).trim();
}
