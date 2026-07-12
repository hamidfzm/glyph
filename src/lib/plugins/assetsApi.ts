import { invoke } from "@tauri-apps/api/core";
import type { AssetsApi } from "./types";

/**
 * `ctx.assets`: read the plugin's own bundled files. No permission is needed,
 * it is the plugin's own reviewed content; Rust re-validates the path and only
 * serves files the installed manifest declares.
 */
export function createAssetsApi(pluginId: string): AssetsApi {
  const readBinary = async (path: string): Promise<Uint8Array> => {
    const bytes = await invoke<number[]>("read_plugin_asset", { id: pluginId, path });
    return new Uint8Array(bytes);
  };
  return {
    readBinary,
    readText: async (path) => new TextDecoder().decode(await readBinary(path)),
  };
}
