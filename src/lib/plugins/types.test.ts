import { describe, expect, it } from "vitest";
import type { GlyphPlugin, SidebarPanelContribution } from "./types";

// These are compile-time contract checks: they fail `tsc` (not just at runtime)
// if the public types regress. The runtime assertions exist only so vitest has
// something to run.
describe("plugin types contract", () => {
  it("allows a mount with no return (no cleanup needed)", () => {
    const panel: SidebarPanelContribution = {
      id: "p",
      title: "Panel",
      mount: (el) => {
        el.textContent = "hi";
      },
    };
    expect(panel.id).toBe("p");
  });

  it("allows a mount that registers cleanup", () => {
    const panel: SidebarPanelContribution = {
      id: "p",
      title: "Panel",
      mount: (_el, registerCleanup) => {
        registerCleanup(() => {
          /* cleanup */
        });
      },
    };
    expect(typeof panel.mount).toBe("function");
  });

  it("describes a plugin with manifest + activate", () => {
    const plugin: GlyphPlugin = {
      manifest: { id: "com.x.demo", name: "Demo", version: "1.0.0", apiVersion: "^1.0.0" },
      activate(ctx) {
        ctx.notify("hello");
      },
    };
    expect(plugin.manifest.id).toBe("com.x.demo");
  });
});
