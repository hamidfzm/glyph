import type { PluginModule } from "./types";

/** Dynamic-import indirection so tests can substitute a fake importer. */
export type ModuleImporter = (url: string) => Promise<unknown>;

const nativeImporter: ModuleImporter = (url) => import(/* @vite-ignore */ url);

/** Base64-encode UTF-8 text (btoa alone only handles Latin-1). */
function toBase64(source: string): string {
  const bytes = new TextEncoder().encode(source);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function isPluginModule(value: unknown): value is PluginModule {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as PluginModule).activate === "function"
  );
}

/**
 * Turn a plugin entry file's source text into a live module. The source is
 * wrapped in a `data:` URL and dynamically imported, so the plugin is a real
 * ESM module (own scope, `import`-able syntax) without touching the network or
 * the bundler, and the same mechanism works in the webview and under Node
 * (tests). The module must default-export a {@link PluginModule}; anything
 * else is rejected with a descriptive error.
 */
export async function importPluginModule(
  source: string,
  importer: ModuleImporter = nativeImporter,
): Promise<PluginModule> {
  const url = `data:text/javascript;base64,${toBase64(source)}`;
  const module = (await importer(url)) as { default?: unknown };
  if (!isPluginModule(module?.default)) {
    throw new Error("plugin entry must default-export an object with an activate() function");
  }
  return module.default;
}
