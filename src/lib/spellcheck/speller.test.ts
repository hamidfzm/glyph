import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { nspellMock } = vi.hoisted(() => ({
  nspellMock: vi.fn(() => ({ correct: () => true, suggest: () => [], add: vi.fn() })),
}));
vi.mock("nspell", () => ({ default: nspellMock }));

import { clearSpellerCache, getSpeller } from "./speller";

describe("getSpeller", () => {
  beforeEach(() => {
    clearSpellerCache();
    nspellMock.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ text: () => Promise.resolve("dictionary-data") })),
    );
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
});
