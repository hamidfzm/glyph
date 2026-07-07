import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { nspellMock } = vi.hoisted(() => ({
  nspellMock: vi.fn(() => ({ correct: () => true, suggest: () => [], add: vi.fn() })),
}));
vi.mock("nspell", () => ({ default: nspellMock }));

import { clearSpellerCache, getSpeller } from "./speller";

function okResponse() {
  return Promise.resolve({ ok: true, text: () => Promise.resolve("dictionary-data") });
}

describe("getSpeller", () => {
  beforeEach(() => {
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
});
