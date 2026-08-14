// A wide table has nowhere to go: the page itself never scrolls sideways
// (app.css sets overflow: hidden on html/body/#root), so without a scroller of
// its own the overflowing columns are clipped and unreachable. Mirrors what
// CsvTable already does for CSV files. No tabIndex: current WebView engines
// make an overflow container keyboard-scrollable on their own, and adding one
// would put a tab stop in front of every table in a document.
export function TableComponent(props: React.ComponentProps<"table">) {
  return (
    <div className="markdown-table-wrapper">
      <table {...props} />
    </div>
  );
}
