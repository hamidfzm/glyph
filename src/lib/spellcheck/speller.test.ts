import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { nspellMock } = vi.hoisted(() => ({
  nspellMock: vi.fn(() => ({ correct: () => true, suggest: () => [], add: vi.fn() })),
}));
vi.mock("nspell", () => ({ default: nspellMock }));

import { clearDictionarySources, registerDictionarySource } from "./dictionarySources";
import { clearSpellerCache, getSpeller } from "./speller";

function okResponse() {
  return Promise.resolve({ ok: true, text: () => Promise.resolve("dictionary-data") });
}

describe("getSpeller", () => {
  beforeEach(() => {
    clearDictionarySources();
    clearSpellerCache();
    nspellMock.mockClear();
    vi.stubGlobal("fetch", vi.fn(okResponse));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads and parses a language once, then reuses it", async () => {
    const first = getSpeller("en");
    const second = getSpeller("en");
    expect(first).toBe(second);
    await first;
    // one aff + one dic fetch, a single nspell construction
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(nspellMock).toHaveBeenCalledTimes(1);
  });

  it("reloads a language after the cache is cleared", async () => {
    await getSpeller("en");
    clearSpellerCache();
    await getSpeller("en");
    expect(nspellMock).toHaveBeenCalledTimes(2);
  });

  it("rejects on a non-ok response instead of building from an error body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve("<html>") }),
      ),
    );
    await expect(getSpeller("en")).rejects.toThrow();
    expect(nspellMock).not.toHaveBeenCalled();
  });

  it("does not cache a failed load, so the next call retries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve("") })),
    );
    await expect(getSpeller("en")).rejects.toThrow();

    const recovered = vi.fn(okResponse);
    vi.stubGlobal("fetch", recovered);
    await getSpeller("en");
    expect(recovered).toHaveBeenCalled();
  });

  it("prefers a registered dictionary source over the bundled assets", async () => {
    const load = vi.fn(() => Promise.resolve({ aff: "FA-AFF", dic: "FA-DIC" }));
    registerDictionarySource({ language: "fa", label: "Persian", load });

    await getSpeller("fa");
    expect(load).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(nspellMock).toHaveBeenCalledWith("FA-AFF", "FA-DIC");
  });

  it("drops the cached checker when the language's source changes", async () => {
    const dispose = registerDictionarySource({
      language: "fa",
      label: "Persian",
      load: () => Promise.resolve({ aff: "A1", dic: "D1" }),
    });
    await getSpeller("fa");
    expect(nspellMock).toHaveBeenCalledTimes(1);

    // Unregistering invalidates; the next request falls back to bundled assets.
    dispose();
    await getSpeller("fa");
    expect(fetch).toHaveBeenCalledTimes(2); // aff + dic from public/
    expect(nspellMock).toHaveBeenCalledTimes(2);
  });
});
