import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import type { ExtraProps } from "react-markdown";
import { ExpandIcon } from "@/components/icons/ExpandIcon";
import { useLightbox } from "@/contexts/LightboxContext";

// A wide table has nowhere to go: the page itself never scrolls sideways
// (app.css sets overflow: hidden on html/body/#root), so without a scroller of
// its own the overflowing columns are clipped and unreachable. Mirrors what
// CsvTable already does for CSV files. No tabIndex: current WebView engines
// make an overflow container keyboard-scrollable on their own.
// The expand button sits outside the scroller so it stays in the corner while
// the columns scroll. Print hides it, and exports strip every button.
export function TableComponent({ node: _node, ...props }: ComponentProps<"table"> & ExtraProps) {
  const { t } = useTranslation("common");
  const lightbox = useLightbox();

  return (
    <div className="markdown-table">
      {lightbox && (
        <button
          type="button"
          className="table-expand-button"
          onClick={(e) => lightbox.openTable(props.children, e.currentTarget)}
          aria-label={t("lightbox.expandTable")}
          title={t("lightbox.expandTable")}
          data-print-hide="true"
        >
          <ExpandIcon />
        </button>
      )}
      <div className="markdown-table-wrapper">
        <table {...props} />
      </div>
    </div>
  );
}
