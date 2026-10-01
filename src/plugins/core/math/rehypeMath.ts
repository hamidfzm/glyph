import type { MarkdownPlugin } from "@/lib/plugins/types";
import { rehypeMathMarker } from "./rehypeMathMarker";

/** KaTeX rendering inside the math marker, imported on first use. */
export async function loadRehypeMath(): Promise<MarkdownPlugin> {
  const { default: rehypeKatex } = await import("rehype-katex");
  return { plugins: [rehypeMathMarker, rehypeKatex] };
}
