import { Component, type ErrorInfo, type ReactNode } from "react";
import { captureException } from "@/lib/telemetry";

interface ErrorBoundaryProps {
  fallback: ReactNode;
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

// Top-level render-error boundary. Reports through the telemetry facade
// instead of Sentry's own boundary component so the SDK stays out of the
// startup bundle (it loads only after the production opt-in).
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    // Keep the component trail Sentry.ErrorBoundary used to attach.
    captureException(error, {
      contexts: { react: { componentStack: errorInfo.componentStack } },
    });
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}
