import { invoke } from "@tauri-apps/api/core";

// What the backend did when asked to make Glyph the default Markdown app.
// "registered" = set for us; "openedSettings" = OS Default Apps page opened;
// "guidance" = no programmatic path, show manual steps; "error" = it failed.
export type DefaultAppOutcome = "registered" | "openedSettings" | "guidance" | "error";

/** Ask the backend to set (or guide the user to set) Glyph as the default
 *  Markdown handler. Never rejects; a failure resolves to "error". */
export async function setDefaultMarkdownApp(): Promise<DefaultAppOutcome> {
  try {
    return (await invoke<string>("set_default_markdown_app")) as DefaultAppOutcome;
  } catch (err) {
    console.error("Failed to set the default Markdown app:", err);
    return "error";
  }
}
