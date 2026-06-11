import { describe, expect, it } from "vitest";
import type { PluginModule, StatusBarItemContribution } from "./types";

// These are compile-time contract checks: they fail `tsc` (not just at runtime)
// if the public types regress. The runtime assertions exist only so vitest has
// something to run.
describe("plugin types contract", () => {
  it("allows a mount with no cleanup", () => {
    const item: StatusBarItemContribution = {
      id: "i",
      mount: (el) => {
        el.textContent = "hi";
      },
    };
    expect(item.id).toBe("i");
  });

  it("allows a mount that registers cleanup", () => {
    const item: StatusBarItemContribution = {
      id: "i",
      mount: (_el, registerCleanup) => {
        registerCleanup(() => {
          /* cleanup */
        });
      },
    };
    expect(typeof item.mount).toBe("function");
  });

  it("describes a plugin entry module with activate and optional deactivate", () => {
    const module: PluginModule = {
      activate(ctx) {
        ctx.notify(`hello from API ${ctx.apiVersion}`);
      },
      deactivate() {},
    };
    expect(typeof module.activate).toBe("function");
  });
});
