import type { ComponentPropsWithoutRef } from "react";
import { EmbedComponent } from "./EmbedComponent";

// react-markdown maps by tag name, so every `<div>` routes through here: a
// note-embed placeholder emitted by remarkWikilink becomes EmbedComponent,
// everything else (alerts, raw HTML, a user's own `class="markdown-embed"`
// div) renders as a plain div. The `data-embed-target` marker is only ever set
// by the plugin, so it distinguishes a real placeholder from arbitrary markup.
export function DivComponent(props: ComponentPropsWithoutRef<"div"> & { node?: unknown }) {
  const { node: _node, ...rest } = props;
  if ("data-embed-target" in rest) {
    return <EmbedComponent {...rest} />;
  }
  return <div {...rest} />;
}
