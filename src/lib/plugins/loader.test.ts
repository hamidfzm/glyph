import { describe, expect, it, vi } from "vitest";
import { importPluginModule } from "./loader";
import type { GlyphPluginContext } from "./types";

/** The plugins under test only call `notify`. */
function notifyOnlyContext(notify: GlyphPluginContext["notify"]): GlyphPluginContext {
  return { notify } as unknown as GlyphPluginContext;
}

describe("importPluginModule", () => {
  it("imports real ESM source and returns its default export", async () => {
    const source = `
      let count = 0;
      export default {
        activate(ctx) { count += 1; ctx.notify("activated " + count); },
      };
    `;
    const module = await importPluginModule(source);

    const notify = vi.fn();
    module.activate(notifyOnlyContext(notify));
    expect(notify).toHaveBeenCalledWith("activated 1");
  });

  it("imports unicode source intact", async () => {
    const module = await importPluginModule(
      `export default { activate(ctx) { ctx.notify("héllo ✓ ☃"); } };`,
    );
    const notify = vi.fn();
    module.activate(notifyOnlyContext(notify));
    expect(notify).toHaveBeenCalledWith("héllo ✓ ☃");
  });

  it("rejects a module without a default export", async () => {
    await expect(importPluginModule("export const x = 1;")).rejects.toThrow(/default-export/);
  });

  it("rejects a default export without an activate function", async () => {
    await expect(importPluginModule("export default { activate: 42 };")).rejects.toThrow(
      /activate/,
    );
  });

  it("propagates syntax errors from the import itself", async () => {
    await expect(importPluginModule("export default {")).rejects.toThrow();
  });

  it("supports an injected importer", async () => {
    const plugin = { activate: vi.fn() };
    const importer = vi.fn().mockResolvedValue({ default: plugin });

    const result = await importPluginModule("ignored", importer);

    expect(result).toBe(plugin);
    expect(importer).toHaveBeenCalledWith(expect.stringMatching(/^data:text\/javascript/));
  });
});
