import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./components/App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ErrorFallback } from "./components/ErrorFallback";
import { SettingsProvider } from "./contexts/SettingsProvider";
import "./styles/app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* Captures React render errors. Reporting is a no-op until telemetry is
        initialized (production + opted in); see src/lib/telemetry.ts. */}
    <ErrorBoundary fallback={<ErrorFallback />}>
      <SettingsProvider>
        <App />
      </SettingsProvider>
    </ErrorBoundary>
  </StrictMode>,
);
