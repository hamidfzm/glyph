import type { HostMessage, WorkerMessage } from "@/lib/plugins/sandbox/protocol";
import type { WorkerLike } from "@/lib/plugins/sandbox/sandbox";

/**
 * In-memory stand-in for the sandbox worker (jsdom has no Worker). Tests read
 * what the host posted from `posted` and drive the bridge with `emit`.
 */
export class FakeWorker implements WorkerLike {
  posted: HostMessage[] = [];
  terminated = false;
  onmessage: ((event: { data: WorkerMessage }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  postMessage(message: HostMessage): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(data: WorkerMessage): void {
    this.onmessage?.({ data });
  }
}
