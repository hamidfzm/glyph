import { useTranslation } from "react-i18next";
import { extractHeadingSection } from "@/lib/headingSection";
import { isNestedTarget } from "@/lib/wikilinkResolver";
import { MarkdownContent } from "./MarkdownContent";

const PLACEHOLDER_CLASS = "text-sm text-[var(--color-text-secondary)]";

export type PreviewLoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; content: string };

interface WikilinkPreviewBodyProps {
  state: PreviewLoadState;
  /** Absolute path of the resolved note, or undefined when it does not exist. */
  path?: string;
  target: string;
  heading?: string;
  workspaceFiles?: string[];
  /** Offers a "create note" action for an unresolved target; null when the
   *  workspace cannot accept one. */
  createNote: ((target: string) => Promise<void>) | null;
}

/** What the hover popover shows: a not-found placeholder with an optional
 *  create action, a loading or error line, or the rendered note section. */
export function WikilinkPreviewBody({
  state,
  path,
  target,
  heading,
  workspaceFiles,
  createNote,
}: WikilinkPreviewBodyProps) {
  const { t } = useTranslation("common");
  if (!path) {
    // A nested target (`[[folder/note]]`) is skipped: rename_path collapses
    // separators into a single component, so the created file wouldn't satisfy
    // the link anyway.
    const canCreate = createNote && !isNestedTarget(target);
    return (
      <div className={PLACEHOLDER_CLASS}>
        <p>{t("wikilinkPreview.notFound", { target })}</p>
        {canCreate && (
          <button
            type="button"
            className="mt-2 rounded-[var(--glyph-radius-sm)] border border-[var(--color-border)] px-2 py-1 text-[var(--color-accent)] hover:bg-[color-mix(in_srgb,var(--color-accent)_16%,transparent)]"
            onClick={() => createNote(target)}
          >
            {t("wikilinkPreview.createNote")}
          </button>
        )}
      </div>
    );
  }

  if (state.status === "loading") {
    return <p className={PLACEHOLDER_CLASS}>{t("wikilinkPreview.loading")}</p>;
  }
  if (state.status === "error") {
    return <p className={PLACEHOLDER_CLASS}>{t("wikilinkPreview.error", { target })}</p>;
  }

  const content = heading ? extractHeadingSection(state.content, heading) : state.content;
  if (heading && content === "") {
    return <p className={PLACEHOLDER_CLASS}>{t("wikilinkPreview.headingNotFound", { heading })}</p>;
  }

  // filePath=path resolves the preview's own wikilinks against the target and
  // extends EmbedContext.chain, so an embed inside it can't recurse forever.
  return (
    <div className="markdown-body markdown-preview-body" dir="auto">
      <MarkdownContent
        content={content}
        filePath={path}
        workspaceFiles={workspaceFiles}
        showFrontmatter={false}
      />
    </div>
  );
}
