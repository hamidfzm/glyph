import { getStore, type Store } from "@tauri-apps/plugin-store";

/**
 * Attach to a store the backend opened at startup (src-tauri/src/setup.rs);
 * the renderer holds no `store:allow-load` (docs/security/threat-model.md).
 */
export async function openStore(file: string): Promise<Store> {
  const store = await getStore(file);
  if (!store) throw new Error(`${file} was not opened by the backend`);
  return store;
}
