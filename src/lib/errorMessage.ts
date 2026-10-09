/** A thrown value as text. A rejected Tauri command throws its `Err` string, not an Error. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
