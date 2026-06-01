import * as Sentry from "@sentry/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./components/App";
import { SettingsProvider } from "./contexts/SettingsContext";
import "./styles/app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* Captures React render errors. No-op until telemetry is initialized
        (production + opted in); see src/lib/telemetry.ts. */}
    <Sentry.ErrorBoundary
      fallback={
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
      }
    >
      <SettingsProvider>
        <App />
      </SettingsProvider>
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
