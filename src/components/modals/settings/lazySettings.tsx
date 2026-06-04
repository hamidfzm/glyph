import { type ComponentProps, lazy, Suspense } from "react";

// The settings UI (modal shell + six tabs + form controls) isn't needed at
// launch and most sessions never open it, so keep it out of the main bundle and
// load it on demand. Suspense is wrapped here so callers use this as a drop-in
// replacement without thinking about the lazy/Suspense plumbing. AppShell only
// mounts this when the modal is actually open, so the chunk loads on first open.
const SettingsModalLazy = lazy(() =>
  import("./SettingsModal").then((m) => ({ default: m.SettingsModal })),
);

export function SettingsModal(props: ComponentProps<typeof SettingsModalLazy>) {
  return (
    <Suspense fallback={null}>
      <SettingsModalLazy {...props} />
    </Suspense>
  );
}
