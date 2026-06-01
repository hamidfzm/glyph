import * as Sentry from "@sentry/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./components/App";
import { ErrorFallback } from "./components/ErrorFallback";
import { SettingsProvider } from "./contexts/SettingsContext";
import "./styles/app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* Captures React render errors. No-op until telemetry is initialized
        (production + opted in); see src/lib/telemetry.ts. */}
    <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
      <SettingsProvider>
        <App />
      </SettingsProvider>
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
