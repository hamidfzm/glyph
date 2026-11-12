import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectConsole } from "@/test/consoleGuard";
import { deferred } from "@/test/deferred";
import { clearDictionarySources, registerDictionarySource } from "./dictionarySources";
import { clearSpellcheckEngines, registerSpellcheckEngine } from "./spellcheckEngines";
import { clearSpellerCache, getSpeller } from "./speller";

function fakeChecker(aff: string) {
  return {
    aff,
    correct: vi.fn(() => false),
    suggest: vi.fn(() => ["fix"]),
    add: vi.fn(),
    dispose: vi.fn(),
  };
}

type FakeChecker = ReturnType<typeof fakeChecker>;

// An engine recording every checker it builds, so a test can see which one the
// cache handed out and which were freed.
function fakeEngine() {
  const built: FakeChecker[] = [];
  const create = vi.fn(async (aff: string, _dic: string) => {
    const checker = fakeChecker(aff);
    built.push(checker);
    return checker;
  });
  return { create, built, builtFor: (aff: string) => built.find((checker) => checker.aff === aff) };
}

function register(aff: string, load = () => Promise.resolve({ aff, dic: "DIC" }), language = "fa") {
  return registerDictionarySource({ language, label: language, load });
}

// Let the cache's dispose-on-settle callbacks run.
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("getSpeller", () => {
  let engine: ReturnType<typeof fakeEngine>;

  beforeEach(() => {
    clearDictionarySources();
    clearSpellcheckEngines();
    clearSpellerCache();
    engine = fakeEngine();
    registerSpellcheckEngine(engine);
  });

  it("loads and parses a language once, then reuses it", async () => {
    const load = vi.fn(() => Promise.resolve({ aff: "AFF", dic: "DIC" }));
    register("AFF", load);
    const first = getSpeller("fa");
    expect(getSpeller("fa")).toBe(first);
    await first;
    expect(load).toHaveBeenCalledTimes(1);
    expect(engine.create).toHaveBeenCalledWith("AFF", "DIC");
    expect(engine.create).toHaveBeenCalledTimes(1);
  });

  it("rejects without parsing when no dictionary is registered", async () => {
    expectConsole(/"fa" spell-check dictionary failed to load/);
    await expect(getSpeller("fa")).rejects.toThrow(/no dictionary is registered/);
    expect(engine.create).not.toHaveBeenCalled();
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
    await getSpeller("fa");
    expect(engine.built.map((checker) => checker.aff)).toEqual(["AFF"]);
  });

  it("rejects a dictionary that is not text without parsing it", async () => {
    expectConsole(/"fa" spell-check dictionary failed to load/);
    register("AFF", () => Promise.resolve({ aff: 42, dic: "DIC" } as never));
    await expect(getSpeller("fa")).rejects.toThrow(/not text/);
    expect(engine.create).not.toHaveBeenCalled();
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
    expect(engine.create).not.toHaveBeenCalled();
  });

  it("keeps a dictionary that fails to parse failed until its source changes", async () => {
    expectConsole(/"fa" spell-check dictionary failed to load/);
    engine.create.mockRejectedValueOnce(new Error("bad affix file"));
    register("FIRST");
    const failed = getSpeller("fa");
    await expect(failed).rejects.toThrow("bad affix file");
    await flush();
    expect(getSpeller("fa")).toBe(failed);
    expect(engine.create).toHaveBeenCalledTimes(1);

    register("SECOND");
    await getSpeller("fa");
    expect(engine.builtFor("SECOND")).toBeDefined();
  });

  it("frees the cached checker and loads the new source when it is replaced", async () => {
    register("FIRST");
    await getSpeller("fa");
    register("SECOND");
    await flush();
    expect(engine.builtFor("FIRST")?.dispose).toHaveBeenCalled();
    await getSpeller("fa");
    expect(engine.builtFor("SECOND")).toBeDefined();
  });

  it("frees a checker whose load finishes after its source was replaced", async () => {
    const slow = deferred<{ aff: string; dic: string }>();
    register("FIRST", () => slow.promise);
    const stale = getSpeller("fa");
    register("SECOND");
    const fresh = await getSpeller("fa");

    slow.resolve({ aff: "FIRST", dic: "DIC" });
    await stale;
    await flush();
    expect(engine.builtFor("FIRST")?.dispose).toHaveBeenCalled();
    expect(engine.builtFor("SECOND")?.dispose).not.toHaveBeenCalled();
    expect(await getSpeller("fa")).toBe(fresh);
  });

  it("a stale load failing does not evict the newer source's checker", async () => {
    expectConsole(/"fa" spell-check dictionary failed to load/);
    const slow = deferred<{ aff: string; dic: string }>();
    register("FIRST", () => slow.promise);
    const stale = getSpeller("fa");
    // A plugin update registers again; its instance's checker replaces the old one.
    const freshLoad = vi.fn(() => Promise.resolve({ aff: "SECOND", dic: "DIC" }));
    register("SECOND", freshLoad);
    const fresh = getSpeller("fa");

    slow.reject(new Error("plugin stopped"));
    await expect(stale).rejects.toThrow(/could not be read/);
    expect(getSpeller("fa")).toBe(fresh);
    expect(freshLoad).toHaveBeenCalledTimes(1);
  });

  it("frees the checker when its source is removed", async () => {
    const dispose = register("FIRST");
    await getSpeller("fa");
    dispose();
    await flush();
    expect(engine.builtFor("FIRST")?.dispose).toHaveBeenCalled();
  });

  it("is inert once freed, whatever the engine's checker does", async () => {
    register("FIRST");
    const speller = await getSpeller("fa");
    const checker = engine.built[0];
    expect(speller.correct("word")).toBe(false);
    expect(speller.suggest("word")).toEqual(["fix"]);
    speller.add("word");
    expect(checker.add).toHaveBeenCalledWith("word");

    speller.dispose();
    speller.dispose();
    expect(speller.correct("word")).toBe(true);
    expect(speller.suggest("word")).toEqual([]);
    speller.add("word");
    expect(checker.correct).toHaveBeenCalledTimes(1);
    expect(checker.suggest).toHaveBeenCalledTimes(1);
    expect(checker.add).toHaveBeenCalledTimes(1);
    expect(checker.dispose).toHaveBeenCalledTimes(1);
  });
});

describe("getSpeller across engine changes", () => {
  beforeEach(() => {
    clearDictionarySources();
    clearSpellcheckEngines();
    clearSpellerCache();
  });

  it("checks with the built-in engine until a plugin registers one", async () => {
    register("SET UTF-8", () => Promise.resolve({ aff: "SET UTF-8\n", dic: "1\nhello\n" }));
    const speller = await getSpeller("fa");
    expect(speller.correct("hello")).toBe(true);
    expect(speller.correct("helo")).toBe(false);
  });

  it("rebuilds every dictionary with a new engine, and with the old one once it goes", async () => {
    const first = fakeEngine();
    registerSpellcheckEngine(first);
    register("FA");
    register("DE", undefined, "de");
    await Promise.all([getSpeller("fa"), getSpeller("de")]);

    const second = fakeEngine();
    const removeSecond = registerSpellcheckEngine(second);
    await flush();
    expect(first.built.every((checker) => checker.dispose.mock.calls.length === 1)).toBe(true);
    await Promise.all([getSpeller("fa"), getSpeller("de")]);
    expect(second.built.map((checker) => checker.aff).sort()).toEqual(["DE", "FA"]);

    removeSecond();
    await flush();
    expect(second.built.every((checker) => checker.dispose.mock.calls.length === 1)).toBe(true);
    await getSpeller("fa");
    expect(first.built.filter((checker) => checker.aff === "FA")).toHaveLength(2);
  });

  it("frees a checker the old engine finishes after the engine changed", async () => {
    const slow = deferred<FakeChecker>();
    const old = { create: vi.fn(() => slow.promise) };
    registerSpellcheckEngine(old);
    register("FA");
    const stale = getSpeller("fa");
    await flush();

    const current = fakeEngine();
    registerSpellcheckEngine(current);
    const fresh = getSpeller("fa");
    const late = fakeChecker("FA");
    slow.resolve(late);
    await stale;
    await flush();
    expect(late.dispose).toHaveBeenCalled();
    expect(getSpeller("fa")).toBe(fresh);
    await fresh;
    expect(current.built[0].dispose).not.toHaveBeenCalled();
  });
});
