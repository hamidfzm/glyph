import { afterEach, describe, expect, it, vi } from "vitest";
import { STATIC_RENDER_TIMEOUT_MS, staticRendererFor, staticRenderers } from "./staticRenderers";

afterEach(() => vi.useRealTimers());

describe("staticRendererFor", () => {
  it("finds the static renderer registered for a language until it is disposed", async () => {
    const dispose = staticRenderers.register({
      language: "d2",
      renderStatic: async (code) => `<svg>${code}</svg>`,
    });
    expect(await staticRendererFor("d2")?.("a")).toBe("<svg>a</svg>");
    expect(staticRendererFor("mermaid")).toBeUndefined();

    dispose();
    expect(staticRendererFor("d2")).toBeUndefined();
  });

  it("gives up on a static render that never settles, so export cannot hang", async () => {
    vi.useFakeTimers();
    const dispose = staticRenderers.register({
      language: "d2",
      renderStatic: () => new Promise(() => {}),
    });
    try {
      const pending = staticRendererFor("d2")?.("a");
      const assertion = expect(pending).rejects.toThrow("static render for d2 timed out");
      await vi.advanceTimersByTimeAsync(STATIC_RENDER_TIMEOUT_MS);
      await assertion;
    } finally {
      dispose();
    }
  });

  it("passes a static render's own failure through", async () => {
    const dispose = staticRenderers.register({
      language: "d2",
      renderStatic: async () => {
        throw new Error("bad source");
      },
    });
    try {
      await expect(staticRendererFor("d2")?.("a")).rejects.toThrow("bad source");
    } finally {
      dispose();
    }
  });
});
