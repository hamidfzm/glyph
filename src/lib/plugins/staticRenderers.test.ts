import { describe, expect, it } from "vitest";
import { staticRendererFor, staticRenderers } from "./staticRenderers";

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
});
