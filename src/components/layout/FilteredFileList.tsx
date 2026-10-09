import { useTranslation } from "react-i18next";
import { TabCloseIcon } from "@/components/icons/TabCloseIcon";
import { relativeToRoot } from "@/lib/paths";
import { ToolbarButton } from "./ToolbarButton";

interface FilteredFileListProps {
  label: string;
  paths: readonly string[];
  workspaceRoot: string;
  activeFilePath?: string;
  onOpen: (path: string) => void;
  onClear: () => void;
}

// Replaces the file tree while a plugin filters it (the tags pane, by a tag):
// a flat list, since matches can sit in folders the tree hasn't loaded.
export function FilteredFileList({
  label,
  paths,
  workspaceRoot,
  activeFilePath,
  onOpen,
  onClear,
}: FilteredFileListProps) {
  const { t } = useTranslation("common");

  return (
    <section>
      <div className="flex items-center justify-between gap-2 px-2 mb-2">
        <h3 className="text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider truncate">
          {label}
        </h3>
        <ToolbarButton title={t("sidebar.clearFilter")} onClick={onClear}>
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
                  : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-tertiary)] active:bg-[var(--color-border)]"
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
