import { invoke } from "@tauri-apps/api/core";
import { vi } from "vitest";

export interface ParkedCall {
  args: Record<string, unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

/** Hold every `invoke` open, so a test decides when each call settles and how.
 *  That is what exercises an answer landing after its question went stale. */
export function parkInvoke(): ParkedCall[] {
  const calls: ParkedCall[] = [];
  vi.mocked(invoke).mockImplementation(
    ((_cmd: string, args: Record<string, unknown>) =>
      new Promise((resolve, reject) => {
        calls.push({ args, resolve, reject });
      })) as unknown as typeof invoke,
  );
  return calls;
}
