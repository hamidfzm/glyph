import { type ComponentProps, lazy, Suspense } from "react";

// The plugin marketplace (browse, detail, install flows) is opt-in UI, so its
// code loads on first open instead of at startup. AppModals only mounts this
// while the modal is open. Suspense is wrapped here so callers use it as a
// drop-in replacement, matching lazySettings.
const PluginsModalLazy = lazy(() =>
  import("./PluginsModal").then((m) => ({ default: m.PluginsModal })),
);

export function PluginsModal(props: ComponentProps<typeof PluginsModalLazy>) {
  return (
    <Suspense fallback={null}>
      <PluginsModalLazy {...props} />
    </Suspense>
  );
}
