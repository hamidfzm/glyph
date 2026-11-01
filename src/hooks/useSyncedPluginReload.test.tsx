import { listen } from "@tauri-apps/api/event";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PluginHost } from "@/lib/plugins/host";
import { SETTINGS_SYNCED_EVENT } from "@/lib/settingsSync";
import { useSyncedPluginReload } from "./useSyncedPluginReload";

describe("useSyncedPluginReload", () => {
  it("reloads the plugins a settings sync names, until unmounted", async () => {
    let handler: ((event: { payload: unknown }) => void) | undefined;
    const unlisten = vi.fn();
    vi.mocked(listen).mockImplementationOnce(((event: string, fn: typeof handler) => {
      if (event === SETTINGS_SYNCED_EVENT) handler = fn;
      return Promise.resolve(unlisten);
    }) as unknown as typeof listen);
    const reload = vi.fn(() => Promise.resolve());
    const host = { reload } as unknown as PluginHost;

    const { unmount } = renderHook(() => useSyncedPluginReload(host));
    handler?.({ payload: { pluginIds: ["com.x.demo"] } });
    expect(reload).toHaveBeenCalledWith(["com.x.demo"]);

    unmount();
    await vi.waitFor(() => expect(unlisten).toHaveBeenCalled());
  });
});
