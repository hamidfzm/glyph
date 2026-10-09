import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef } from "react";
import { subscribeReady } from "@/lib/tauriEvent";
import type { PendingOpen } from "@/lib/windowContext";

interface UseOpenRequestsParams {
  openFile: (path: string) => Promise<unknown>;
  openFolder: (root?: string) => Promise<void>;
}

/**
 * Open requests pushed by the backend: a launch (cold start, second instance,
 * macOS file association), a drop onto the window, the folder picker's result.
 *
 * Until this window can hear events the backend queues its opens, and
 * `take_pending_opens` hands the queue over and switches it to emitting. So
 * the listeners attach first and the drain follows: an open either waits in
 * the queue or reaches a listener, never neither and never both.
 */
export function useOpenRequests({ openFile, openFolder }: UseOpenRequestsParams): {
  /** Opens what reached this window before it could listen: `injected`, then
   *  the backend's queue. Resolves to whether there was anything to open. */
  openStartupRequests: (injected: PendingOpen | null) => Promise<boolean>;
} {
  // Read through refs so the listeners attach once: resubscribing whenever a
  // callback changed would leave a moment with no listener at all.
  const openFileRef = useRef(openFile);
  openFileRef.current = openFile;
  const openFolderRef = useRef(openFolder);
  openFolderRef.current = openFolder;
  const attachedRef = useRef<Promise<unknown>>(Promise.resolve());
  const lastRef = useRef<Promise<unknown>>(Promise.resolve());

  // One at a time, in arrival order: a launch naming several files emits them
  // back to back, and letting their loads race would shuffle the tabs and
  // leave whichever finished last active.
  const inOrder = useCallback(<T>(task: () => Promise<T>): Promise<T> => {
    const result = lastRef.current.then(task);
    lastRef.current = result;
    return result;
  }, []);

  const open = useCallback(async (request: PendingOpen) => {
    try {
      if (request.kind === "folder") await openFolderRef.current(request.path);
      else await openFileRef.current(request.path);
    } catch (err) {
      // Caught here so a failed open cannot block the ones behind it.
      console.error("Failed to open:", err);
    }
  }, []);

  useEffect(() => {
    const file = subscribeReady<string>("open-file", (event) => {
      inOrder(() => open({ kind: "file", path: event.payload }));
    });
    const folder = subscribeReady<string>("open-folder", (event) => {
      inOrder(() => open({ kind: "folder", path: event.payload }));
    });
    attachedRef.current = Promise.all([file.ready, folder.ready]);
    return () => {
      file.unsubscribe();
      folder.unsubscribe();
    };
  }, [inOrder, open]);

  const openStartupRequests = useCallback(
    (injected: PendingOpen | null) =>
      // One link in the chain: the backend emits from the drain onward, and an
      // event can overtake the drain's own reply, so it has to wait behind it.
      inOrder(async () => {
        // StrictMode attaches the listeners twice; wait for the pair that stayed.
        let attached: Promise<unknown>;
        do {
          attached = attachedRef.current;
          await attached;
        } while (attached !== attachedRef.current);
        const queued = (await invoke<PendingOpen[]>("take_pending_opens").catch(() => null)) ?? [];
        const requests = injected ? [injected, ...queued] : queued;
        for (const request of requests) await open(request);
        return requests.length > 0;
      }),
    [inOrder, open],
  );

  return { openStartupRequests };
}
