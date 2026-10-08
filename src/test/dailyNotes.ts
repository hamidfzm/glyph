import { invoke } from "@tauri-apps/api/core";
import { vi } from "vitest";
import type { DailyNotesSettings } from "@/lib/workspace";

/** Mock the daily-notes settings commands: reads resolve `settings`, writes succeed. */
export function mockStoredDailyNotes(settings: DailyNotesSettings): void {
  vi.mocked(invoke).mockImplementation(((cmd: string) =>
    cmd === "workspace_get_daily_notes"
      ? Promise.resolve(settings)
      : Promise.resolve(undefined)) as typeof invoke);
}
