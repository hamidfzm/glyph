import { type ComponentProps, lazy, Suspense, useState } from "react";

// The AI panel (chat history, composer, quick actions, provider glue) is
// optional: most sessions never open it, so it stays out of the startup
// bundle. The panel is always-mounted UI (CSS shows/hides it via data-open,
// and it holds the composer draft and scroll position), so it cannot simply
// be unmounted while closed. Instead the chunk loads on the first open and
// the panel stays mounted afterwards.
const AIChatPanelLazy = lazy(() =>
  import("./AIChatPanel").then((m) => ({ default: m.AIChatPanel })),
);

export function AIChatPanel(props: ComponentProps<typeof AIChatPanelLazy>) {
  const [everOpened, setEverOpened] = useState(false);
  if (props.open && !everOpened) {
    setEverOpened(true);
  }
  if (!everOpened && !props.open) {
    return null;
  }
  return (
    <Suspense fallback={null}>
      <AIChatPanelLazy {...props} />
    </Suspense>
  );
}
