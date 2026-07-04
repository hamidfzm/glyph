import { invoke } from "@tauri-apps/api/core";
import { type ComponentPropsWithoutRef, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { OpenIcon } from "@/components/icons/OpenIcon";
import { useEmbedContext } from "@/contexts/EmbedContext";
import { extractHeadingSection } from "@/lib/headingSection";
import { MarkdownContent } from "./MarkdownContent";

type LoadState = { status: "loading" } | { status: "error" } | { status: "ready"; content: string };

// Resolves a `![[note]]` embed placeholder (a `<div class="markdown-embed">`
// emitted by remarkWikilink) into inline content: it reads the target file,
// slices the requested heading section, and renders it through a nested
// MarkdownContent. Broken targets, cycles, and missing headings render a small
// placeholder instead. The recursion guard rides on EmbedContext.chain, which
// each nested MarkdownContent extends with its own file path, so passing the
// target as `filePath` is all that threads the chain to the next level.
export function EmbedComponent(props: ComponentPropsWithoutRef<"div">) {
  const { t } = useTranslation("common");
  const { workspaceFiles, onOpenWikilink, chain } = useEmbedContext();

  const attrs = props as Record<string, unknown>;
  const path = attrs["data-embed-path"] as string | undefined;
  const heading = attrs["data-embed-heading"] as string | undefined;
  const target = (attrs["data-embed-target"] as string | undefined) ?? "";

  const isCircular = !!path && chain.includes(path);
  const canLoad = !!path && !isCircular;

  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    if (!canLoad) return;
    let alive = true;
    setState({ status: "loading" });
    invoke<string>("read_file", { path })
      .then((content) => {
        if (alive) setState({ status: "ready", content });
      })
      .catch(() => {
        if (alive) setState({ status: "error" });
      });
    return () => {
      alive = false;
    };
  }, [canLoad, path]);

  if (!path) {
    return (
      <div className="markdown-embed markdown-embed--broken">{t("embed.broken", { target })}</div>
    );
  }
  if (isCircular) {
    return (
      <div className="markdown-embed markdown-embed--broken">{t("embed.circular", { target })}</div>
    );
  }

  return (
    <div className="markdown-embed">
      {onOpenWikilink && (
        <button
          type="button"
          className="markdown-embed__source"
          title={t("embed.openSource")}
          aria-label={t("embed.openSource")}
          onClick={() => onOpenWikilink(path, heading)}
        >
          <OpenIcon />
        </button>
      )}
      <div className="markdown-embed__body">
        {renderBody(state, path, heading, workspaceFiles, onOpenWikilink, t)}
      </div>
    </div>
  );
}

function renderBody(
  state: LoadState,
  path: string,
  heading: string | undefined,
  workspaceFiles: string[] | undefined,
  onOpenWikilink: ((path: string, heading?: string) => void) | undefined,
  t: (key: string, opts?: Record<string, unknown>) => string,
) {
  if (state.status === "loading" || state.status === "error") {
    return <p className="markdown-embed__status">{t("embed.loading")}</p>;
  }

  const content = heading ? extractHeadingSection(state.content, heading) : state.content;
  if (heading && content === "") {
    return (
      <p className="markdown-embed__status markdown-embed--broken">
        {t("embed.headingNotFound", { heading })}
      </p>
    );
  }

  // filePath=path both resolves the embed's own wikilinks and extends
  // EmbedContext.chain (via MarkdownContent's provider) for cycle detection.
  return (
    <MarkdownContent
      content={content}
      filePath={path}
      workspaceFiles={workspaceFiles}
      onOpenWikilink={onOpenWikilink}
      showFrontmatter={false}
    />
  );
}
