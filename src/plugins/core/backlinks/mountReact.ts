import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Disposer } from "@/lib/plugins/types";

/** Render `node` into a host mount element, in a React root of the plugin's own. */
export function mountReact(
  el: HTMLElement,
  node: ReactNode,
  registerCleanup: (cleanup: Disposer) => void,
): void {
  // An element of its own: the host empties `el` right after cleanup, before
  // React gets to remove what it rendered. It takes no box, so what is
  // rendered lays out as a child of `el`.
  const container = document.createElement("div");
  container.style.display = "contents";
  el.append(container);
  const root = createRoot(container);
  root.render(node);
  // Emptied rather than unmounted: cleanup runs inside the app's commit, where
  // React refuses a synchronous unmount. The root goes with its detached element.
  registerCleanup(() => root.render(null));
}
