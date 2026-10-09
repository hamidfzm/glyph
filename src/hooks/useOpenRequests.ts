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
 * The backend queues each one for this window and emits `opens-pending` as a
 * nudge; the paths only ever travel in the reply to `take_pending_opens`. A
 * nudge missed while the page was loading costs nothing, because the queue is
 * also taken once on mount, after the listener is attached.
 */
export function useOpenRequests({ openFile, openFolder }: UseOpenRequestsParams): {
  /** Opens what reached this window before it could listen: `injected`, then
   *  the backend's queue. Resolves to whether there was anything to open. */
  openStartupRequests: (injected: PendingOpen | null) => Promise<boolean>;
} {
  // Read through refs so the listener attaches once: resubscribing whenever a
  // callback changed would leave a moment with no listener at all.
  const openFileRef = useRef(openFile);
  openFileRef.current = openFile;
  const openFolderRef = useRef(openFolder);
  openFolderRef.current = openFolder;
  const attachedRef = useRef<Promise<void>>(Promise.resolve());
  const lastRef = useRef<Promise<unknown>>(Promise.resolve());

  // One at a time, in arrival order: a launch naming several files queues them
  // together, and letting their loads race would shuffle the tabs and leave
  // whichever finished last active.
  const inOrder = useCallback(<T>(task: () => Promise<T>): Promise<T> => {
    const result = lastRef.current.then(task);
    // A step that failed must not take the ones behind it down with it.
    lastRef.current = result.catch(() => {});
    return result;
  }, []);

  const openAll = useCallback(async (requests: PendingOpen[]) => {
    for (const request of requests) {
      try {
        if (request.kind === "folder") await openFolderRef.current(request.path);
        else await openFileRef.current(request.path);
      } catch (err) {
        console.error("Failed to open:", err);
      }
    }
  }, []);

  const takeQueue = useCallback(
    async () => (await invoke<PendingOpen[]>("take_pending_opens").catch(() => null)) ?? [],
    [],
  );

  useEffect(() => {
    const nudge = subscribeReady("opens-pending", () => {
      inOrder(async () => openAll(await takeQueue()));
    });
    attachedRef.current = nudge.ready;
    return nudge.unsubscribe;
  }, [inOrder, openAll, takeQueue]);

  const openStartupRequests = useCallback(
    (injected: PendingOpen | null) =>
      inOrder(async () => {
        // Listener first, queue second: an open queued in between would have
        // its nudge go unheard. StrictMode attaches the listener twice, so
        // wait for the one that stayed.
        let attached: Promise<void>;
        do {
          attached = attachedRef.current;
          await attached;
        } while (attached !== attachedRef.current);
        const queued = await takeQueue();
        const requests = injected ? [injected, ...queued] : queued;
        await openAll(requests);
        return requests.length > 0;
      }),
    [inOrder, openAll, takeQueue],
  );

  return { openStartupRequests };
}
