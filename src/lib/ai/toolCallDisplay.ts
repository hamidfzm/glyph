// How the chat panel shows a tool call: what it was about, its result, and
// whether that result came from an index that is not complete.

import type { ScanStatus } from "@/lib/workspaceScan";

/** Most of a result the panel puts on screen; the model got all of it. */
export const MAX_SHOWN_CHARS = 20_000;

/** What a call was about: the note, board, or tag it named. */
export function toolCallSubject(input: unknown): string | null {
  if (typeof input !== "object" || input === null) return null;
  const { ref, path, tag } = input as Record<string, unknown>;
  const subject = [ref, path, tag].find((value) => typeof value === "string");
  return typeof subject === "string" ? subject : null;
}

/** `value` indented when it is JSON, as sent otherwise. */
export function prettyJson(value: unknown): string {
  if (typeof value !== "string") return JSON.stringify(value, null, 2);
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

/** A result as the panel shows it, cut past `MAX_SHOWN_CHARS` and saying so. */
export function shownResult(result: string): { text: string; total: number; cut: boolean } {
  const text = prettyJson(result);
  const cut = text.length > MAX_SHOWN_CHARS;
  return { text: cut ? text.slice(0, MAX_SHOWN_CHARS) : text, total: text.length, cut };
}

/** The index status a result reports when the index is not complete: its own
 *  `status`, or that of a vault `vault_context` lists. */
export function incompleteIndex(result: string): ScanStatus | null {
  let parsed: { status?: ScanStatus; vaults?: Array<{ status?: ScanStatus }> };
  try {
    parsed = JSON.parse(result);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const vaults = Array.isArray(parsed.vaults) ? parsed.vaults : [];
  const statuses = [parsed.status, ...vaults.map((vault) => vault?.status)];
  return statuses.find((status) => status?.truncated === true) ?? null;
}
