import { describe, expect, it, vi } from "vitest";
import { importPluginModule } from "./loader";

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
    module.activate({
      apiVersion: "1.0.0",
      commands: { register: vi.fn() },
      ui: {
        addStatusBarItem: vi.fn(),
        addSidebarPanel: vi.fn(),
        addSettingsPanel: vi.fn(),
        addStyles: vi.fn(),
      },
      exporters: { register: vi.fn() },
      spellcheck: { registerDictionary: vi.fn() },
      settings: { get: vi.fn(), set: vi.fn() },
      markdown: {
        registerRemarkPlugin: vi.fn(),
        registerRehypePlugin: vi.fn(),
        registerFencedRenderer: vi.fn(),
      },
      workspace: { readFile: vi.fn(), listFiles: vi.fn() },
      notify,
      registerTranslations: vi.fn(),
    });
    expect(notify).toHaveBeenCalledWith("activated 1");
  });

  it("imports unicode source intact", async () => {
    const module = await importPluginModule(
      `export default { activate(ctx) { ctx.notify("héllo ✓ ☃"); } };`,
    );
    const notify = vi.fn();
    module.activate({
      apiVersion: "1.0.0",
      commands: { register: vi.fn() },
      ui: {
        addStatusBarItem: vi.fn(),
        addSidebarPanel: vi.fn(),
        addSettingsPanel: vi.fn(),
        addStyles: vi.fn(),
      },
      exporters: { register: vi.fn() },
      spellcheck: { registerDictionary: vi.fn() },
      settings: { get: vi.fn(), set: vi.fn() },
      markdown: {
        registerRemarkPlugin: vi.fn(),
        registerRehypePlugin: vi.fn(),
        registerFencedRenderer: vi.fn(),
      },
      workspace: { readFile: vi.fn(), listFiles: vi.fn() },
      notify,
      registerTranslations: vi.fn(),
    });
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
