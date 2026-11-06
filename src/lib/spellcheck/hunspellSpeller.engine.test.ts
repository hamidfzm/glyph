import { beforeEach, describe, expect, it, vi } from "vitest";
import { deferred } from "@/test/deferred";

// The engine module stands in for hunspell-wasm, so a test can hold its
// compile open or fail it; each test re-imports the adapter for a fresh cache.
const { createHunspellFromStrings, getWasmModule } = vi.hoisted(() => ({
  createHunspellFromStrings: vi.fn(() =>
    Promise.resolve({
      isDisposed: false,
      testSpelling: () => true,
      getSpellingSuggestions: () => [],
      addWord: vi.fn(),
      dispose: vi.fn(),
    }),
  ),
  getWasmModule: vi.fn(),
}));
vi.mock("hunspell-wasm", () => ({ createHunspellFromStrings, getWasmModule }));

async function freshAdapter() {
  vi.resetModules();
  return import("./hunspellSpeller");
}

describe("createHunspellSpeller engine load", () => {
  beforeEach(() => {
    createHunspellFromStrings.mockClear();
    getWasmModule.mockReset();
  });

  it("compiles the engine once for dictionaries loading at the same time", async () => {
    const compile = deferred();
    getWasmModule.mockReturnValue(compile.promise);
    const { createHunspellSpeller } = await freshAdapter();

    const both = Promise.all([
      createHunspellSpeller("", "1\na"),
      createHunspellSpeller("", "1\nb"),
    ]);
    compile.resolve();
    await both;
    expect(getWasmModule).toHaveBeenCalledTimes(1);
    expect(createHunspellFromStrings).toHaveBeenCalledTimes(2);
  });

  it("retries the engine after a failed compile", async () => {
    getWasmModule.mockRejectedValueOnce(new Error("wasm fetch failed"));
    const { createHunspellSpeller } = await freshAdapter();

    await expect(createHunspellSpeller("", "1\na")).rejects.toThrow("wasm fetch failed");
    getWasmModule.mockResolvedValueOnce(undefined);
    await expect(createHunspellSpeller("", "1\na")).resolves.toBeDefined();
    expect(getWasmModule).toHaveBeenCalledTimes(2);
  });
});
