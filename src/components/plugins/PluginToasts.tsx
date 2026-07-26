export interface PluginToast {
  id: number;
  message: string;
  /** Failures render in the error palette; anything else uses the neutral surface. */
  tone?: "error";
}

const BASE_CLASS =
  "max-w-[min(28rem,90vw)] px-4 py-2 rounded-lg border text-sm shadow-lg select-none break-words";

const TONE_CLASS = {
  neutral:
    "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)]",
  error: "border-[var(--color-error)] bg-[var(--color-error-bg)] text-[var(--color-error)]",
} as const;

/**
 * Transient notifications raised by plugins via `ctx.notify`. Stacked
 * bottom-center; each toast is added and auto-expired by PluginsProvider.
 */
export function PluginToasts({ toasts }: { toasts: readonly PluginToast[] }) {
  if (toasts.length === 0) return null;
  return (
    // z-[200] clears the modal backdrop (z-index 100 in settings.css): installs are
    // driven from PluginsModal, and under its scrim the toast reads as a black smear.
    // Sitting above the modal means it must not swallow the clicks meant for it.
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[200] flex flex-col items-center gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          aria-live="polite"
          className={`${BASE_CLASS} ${TONE_CLASS[toast.tone ?? "neutral"]}`}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}
