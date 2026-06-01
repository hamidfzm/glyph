// Fallback UI rendered by the top-level Sentry ErrorBoundary (see main.tsx)
// when a render error escapes the tree. Presentational only.
export function ErrorFallback() {
  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
        textAlign: "center",
        color: "var(--color-text-secondary)",
      }}
    >
      <p>Something went wrong. Try reopening the file or restarting Glyph.</p>
    </div>
  );
}
