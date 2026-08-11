import { type ComponentProps, lazy, Suspense } from "react";

// Workspace settings (sync configuration, site export options) is occasional
// UI, so its code loads on first open instead of at startup. AppModals only
// mounts this while the modal is open. Suspense is wrapped here so callers use
// it as a drop-in replacement, matching lazySettings.
const WorkspaceSettingsModalLazy = lazy(() =>
  import("./WorkspaceSettingsModal").then((m) => ({ default: m.WorkspaceSettingsModal })),
);

export function WorkspaceSettingsModal(props: ComponentProps<typeof WorkspaceSettingsModalLazy>) {
  return (
    <Suspense fallback={null}>
      <WorkspaceSettingsModalLazy {...props} />
    </Suspense>
  );
}
