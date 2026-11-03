import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectConsole } from "@/test/consoleGuard";
import { deferred } from "@/test/deferred";

const { createHunspellSpeller } = vi.hoisted(() => ({
  createHunspellSpeller: vi.fn((aff: string, _dic: string) =>
    Promise.resolve({
      aff,
      correct: () => true,
      suggest: () => [],
      add: vi.fn(),
      dispose: vi.fn(),
    }),
  ),
}));
vi.mock("./hunspellSpeller", () => ({ createHunspellSpeller }));

import { clearDictionarySources, registerDictionarySource } from "./dictionarySources";
import { clearSpellerCache, getSpeller } from "./speller";

type FakeSpeller = Awaited<ReturnType<typeof createHunspellSpeller>>;

function register(aff: string, load = () => Promise.resolve({ aff, dic: "DIC" })) {
  return registerDictionarySource({ language: "fa", label: "Persian", load });
}

async function loadFa(): Promise<FakeSpeller> {
  return (await getSpeller("fa")) as unknown as FakeSpeller;
}

// Let the cache's dispose-on-settle callbacks run.
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("getSpeller", () => {
  beforeEach(() => {
    clearDictionarySources();
    clearSpellerCache();
    createHunspellSpeller.mockClear();
  });

  it("loads and parses a language once, then reuses it", async () => {
    const load = vi.fn(() => Promise.resolve({ aff: "AFF", dic: "DIC" }));
    register("AFF", load);
    const first = getSpeller("fa");
    expect(getSpeller("fa")).toBe(first);
    await first;
    expect(load).toHaveBeenCalledTimes(1);
    expect(createHunspellSpeller).toHaveBeenCalledWith("AFF", "DIC");
    expect(createHunspellSpeller).toHaveBeenCalledTimes(1);
  });

  it("rejects without parsing when no dictionary is registered", async () => {
    expectConsole(/"fa" spell-check dictionary failed to load/);
    await expect(getSpeller("fa")).rejects.toThrow(/no dictionary is registered/);
    expect(createHunspellSpeller).not.toHaveBeenCalled();
  });

  it("logs a failed read and retries it on the next call", async () => {
    expectConsole(/"fa" spell-check dictionary failed to load/);
    let attempt = 0;
    register("AFF", () => {
      attempt += 1;
      return attempt === 1
        ? Promise.reject(new Error("asset missing"))
        : Promise.resolve({ aff: "AFF", dic: "DIC" });
    });
    await expect(getSpeller("fa")).rejects.toThrow(/could not be read/);
    await flush();
    await expect(loadFa()).resolves.toMatchObject({ aff: "AFF" });
  });

  it("rejects a dictionary that is not text without parsing it", async () => {
    expectConsole(/"fa" spell-check dictionary failed to load/);
    register("AFF", () => Promise.resolve({ aff: 42, dic: "DIC" } as never));
    await expect(getSpeller("fa")).rejects.toThrow(/not text/);
    expect(createHunspellSpeller).not.toHaveBeenCalled();
  });

  it("rejects an oversized dictionary once, without parsing or reading it again", async () => {
    expectConsole(/"fa" spell-check dictionary failed to load/);
    const load = vi.fn(() => Promise.resolve({ aff: "", dic: "x".repeat(32_000_001) }));
    register("AFF", load);
    const refused = getSpeller("fa");
    await expect(refused).rejects.toThrow(/size limit/);
    await flush();
    expect(getSpeller("fa")).toBe(refused);
    expect(load).toHaveBeenCalledTimes(1);
    expect(createHunspellSpeller).not.toHaveBeenCalled();
  });

  it("keeps a dictionary that fails to parse failed until its source changes", async () => {
    expectConsole(/"fa" spell-check dictionary failed to load/);
    createHunspellSpeller.mockRejectedValueOnce(new Error("Aborted()"));
    register("FIRST");
    const failed = getSpeller("fa");
    await expect(failed).rejects.toThrow("Aborted()");
    await flush();
    expect(getSpeller("fa")).toBe(failed);
    expect(createHunspellSpeller).toHaveBeenCalledTimes(1);

    register("SECOND");
    await expect(loadFa()).resolves.toMatchObject({ aff: "SECOND" });
  });

  it("frees the cached checker and loads the new source when it is replaced", async () => {
    register("FIRST");
    const first = await loadFa();
    register("SECOND");
    await flush();
    expect(first.dispose).toHaveBeenCalled();
    await expect(loadFa()).resolves.toMatchObject({ aff: "SECOND" });
  });

  it("frees a checker whose load finishes after its source was replaced", async () => {
    const slow = deferred<{ aff: string; dic: string }>();
    register("FIRST", () => slow.promise);
    const stale = getSpeller("fa");
    register("SECOND");
    const fresh = await loadFa();

    slow.resolve({ aff: "FIRST", dic: "DIC" });
    const settled = (await stale) as unknown as FakeSpeller;
    await flush();
    expect(settled.dispose).toHaveBeenCalled();
    expect(fresh.dispose).not.toHaveBeenCalled();
    expect(await loadFa()).toBe(fresh);
  });

  it("a stale load failing does not evict the newer source's checker", async () => {
    expectConsole(/"fa" spell-check dictionary failed to load/);
    const slow = deferred<{ aff: string; dic: string }>();
    register("FIRST", () => slow.promise);
    const stale = getSpeller("fa");
    register("SECOND");
    const fresh = getSpeller("fa");

    slow.reject(new Error("first source broke"));
    await expect(stale).rejects.toThrow(/could not be read/);
    expect(getSpeller("fa")).toBe(fresh);
  });

  it("frees the checker when its source is removed", async () => {
    const dispose = register("FIRST");
    const speller = await loadFa();
    dispose();
    await flush();
    expect(speller.dispose).toHaveBeenCalled();
  });
});
