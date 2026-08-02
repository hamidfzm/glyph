import { useTranslation } from "react-i18next";
import { TabCloseIcon } from "@/components/icons/TabCloseIcon";
import { relativeToRoot } from "@/lib/paths";
import { ToolbarButton } from "./ToolbarButton";

interface TagFileListProps {
  tag: string;
  paths: string[];
  workspaceRoot: string;
  activeFilePath?: string;
  onOpen: (path: string) => void;
  onClear: () => void;
}

// Replaces the file tree while a tag filter is active: a flat list of the
// matching documents, since matches can sit in folders the tree hasn't loaded.
// The caller only filters by a tag that exists, so `paths` is never empty.
export function TagFileList({
  tag,
  paths,
  workspaceRoot,
  activeFilePath,
  onOpen,
  onClear,
}: TagFileListProps) {
  const { t } = useTranslation("common");

  return (
    <section>
      <div className="flex items-center justify-between gap-2 px-2 mb-2">
        <h3 className="text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider truncate">
          {t("tags.filtered", { tag, total: paths.length })}
        </h3>
        <ToolbarButton title={t("tags.clearFilter")} onClick={onClear}>
          <TabCloseIcon />
        </ToolbarButton>
      </div>
      <ul className="space-y-0.5">
        {paths.map((path) => (
          <li key={path}>
            <button
              type="button"
              onClick={() => onOpen(path)}
              className={`w-full text-start text-sm px-2 py-1 rounded-[var(--glyph-radius-sm)] truncate transition-colors ${
                activeFilePath === path
                  ? "bg-[var(--color-accent)] text-white font-medium"
                  : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-tertiary)]"
              }`}
              title={path}
            >
              {relativeToRoot(path, workspaceRoot)}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
