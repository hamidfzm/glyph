export interface PluginToast {
  id: number;
  message: string;
}

/**
 * Transient notifications raised by plugins via `ctx.notify`. Stacked
 * bottom-center; each toast is added and auto-expired by PluginsProvider.
 */
export function PluginToasts({ toasts }: { toasts: readonly PluginToast[] }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          aria-live="polite"
          className="px-4 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-sm text-[var(--color-text-primary)] shadow-lg select-none"
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}
