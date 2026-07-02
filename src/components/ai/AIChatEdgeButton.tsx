import { useTranslation } from "react-i18next";
import { SparkleIcon } from "@/components/icons/SparkleIcon";

interface AIChatEdgeButtonProps {
  onClick: () => void;
}

// Vertical strip on the inline-end edge of the content row, shown while the
// AI chat panel is closed. Mirrors the sidebar EdgeExpand affordance so the
// chat is one click away without taking layout space.
export function AIChatEdgeButton({ onClick }: AIChatEdgeButtonProps) {
  const { t } = useTranslation("ai");
  return (
    <button
      type="button"
      data-print-hide="true"
      onClick={onClick}
      title={t("title")}
      aria-label={t("title")}
      className="shrink-0 w-7 flex items-center justify-center border-s border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-tertiary)] transition-colors cursor-pointer"
      style={{ background: "var(--color-surface-secondary)" }}
    >
      <SparkleIcon />
    </button>
  );
}
