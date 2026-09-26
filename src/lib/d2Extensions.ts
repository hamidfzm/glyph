// `.d2` is an OS file association (see `tauri.conf.json`), so the app always
// knows the extension; rendering it is the D2 core plugin's job (see
// `sourceDocuments.ts`).

import { D2_EXTENSIONS, hasExtension } from "./extensionConfig";

export { D2_EXTENSIONS };

export function isD2File(path: string): boolean {
  return hasExtension(path, D2_EXTENSIONS);
}
