import { useEffect } from "react";
import { useTabsContext } from "@/contexts/TabsContext";
import { useBoundShortcuts } from "@/hooks/useBoundShortcuts";
import type { Platform } from "@/hooks/usePlatform";

const MOUSE_BACK_BUTTON = 3;
const MOUSE_FORWARD_BUTTON = 4;

// Back/forward through the navigation history: the navigate-back /
// navigate-forward bindings (remappable in Settings → Hotkeys) and the side
// buttons of a mouse.
export function useNavigationShortcuts({ platform }: { platform: Platform }) {
  const { navigateBack, navigateForward } = useTabsContext();
  useBoundShortcuts(platform, {
    "navigate-back": navigateBack,
    "navigate-forward": navigateForward,
  });

  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      const isBack = event.button === MOUSE_BACK_BUTTON;
      const isForward = event.button === MOUSE_FORWARD_BUTTON;
      if (!isBack && !isForward) return;
      // A click inside a modal stays with the modal; navigating the document
      // behind it would leave the dialog pointing at the wrong tab.
      if (event.target instanceof Element && event.target.closest('[role="dialog"]')) return;
      // The webview would otherwise walk its own page history.
      event.preventDefault();
      if (isBack) navigateBack();
      else navigateForward();
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [navigateBack, navigateForward]);
}
