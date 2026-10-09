import type { GlyphPluginContext } from "@/lib/plugins/types";
import { dailyNotePath, dailyNotesProblem } from "./notePath";
import { type DailyNotesSettings, readSettings } from "./settings";

export type Translate = (key: string, values?: Record<string, unknown>) => string;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The template's text, which a new note starts as a copy of. */
async function newNoteContent(
  ctx: GlyphPluginContext,
  settings: DailyNotesSettings,
  notePath: string,
): Promise<string> {
  if (settings.template === "") return "";
  try {
    return await ctx.workspace.readFile(settings.template);
  } catch (err) {
    // The template only matters for a new note: one that is already there
    // still opens, and createFile leaves it as it is.
    const noteExists = await ctx.workspace.readFile(notePath).then(
      () => true,
      () => false,
    );
    if (noteExists) return "";
    throw err;
  }
}

/** "Open Today's Note": create today's file from the workspace's settings when it is missing, then open it. */
export function createTodaysNoteOpener(ctx: GlyphPluginContext, t: Translate): () => Promise<void> {
  // A repeat while one request is in flight would only race it to the same file.
  let pending = false;

  return async () => {
    if (pending) return;
    pending = true;
    try {
      const root = ctx.workspace.getRoot();
      const settings = readSettings(await ctx.workspace.getSettings());
      const today = new Date();
      const problem = dailyNotesProblem(settings, today);
      if (problem) {
        ctx.notify(t(`problem.${problem}`));
        return;
      }
      const path = dailyNotePath(settings, today);
      const content = await newNoteContent(ctx, settings, path);
      const note = await ctx.workspace.createFile(path, content);
      // The workspace was closed or replaced meanwhile: not this window's note to open.
      if (ctx.workspace.getRoot() !== root) return;
      ctx.navigation.openFile(note.path);
    } catch (err) {
      ctx.notify(t("failed", { error: errorMessage(err) }));
    } finally {
      pending = false;
    }
  };
}
