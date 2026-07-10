import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearDictionarySources,
  type DictionaryContribution,
  getDictionarySource,
  listDictionarySources,
  registerDictionarySource,
  subscribeDictionarySources,
} from "./dictionarySources";

function contribution(overrides: Partial<DictionaryContribution> = {}): DictionaryContribution {
  return {
    language: "fa",
    label: "فارسی (Persian)",
    load: () => Promise.resolve({ aff: "AFF", dic: "DIC" }),
    ...overrides,
  };
}

describe("dictionarySources", () => {
  beforeEach(() => {
    clearDictionarySources();
  });

  it("registers a dictionary and lists it until disposed", () => {
    const dispose = registerDictionarySource(contribution());
    expect(getDictionarySource("fa")?.label).toBe("فارسی (Persian)");
    expect(listDictionarySources().map((d) => d.language)).toEqual(["fa"]);

    dispose();
    expect(getDictionarySource("fa")).toBeUndefined();
    expect(listDictionarySources()).toEqual([]);
  });

  it("a later registration for the same language replaces the earlier one", () => {
    const disposeFirst = registerDictionarySource(contribution({ label: "First" }));
    registerDictionarySource(contribution({ label: "Second" }));
    expect(getDictionarySource("fa")?.label).toBe("Second");

    // Disposing the superseded registration must not remove the newer one.
    disposeFirst();
    expect(getDictionarySource("fa")?.label).toBe("Second");
  });

  it("notifies subscribers with the language on register and dispose", () => {
    const listener = vi.fn();
    subscribeDictionarySources(listener);

    const dispose = registerDictionarySource(contribution());
    expect(listener).toHaveBeenCalledWith("fa");

    listener.mockClear();
    dispose();
    expect(listener).toHaveBeenCalledWith("fa");
  });

  it("unsubscribing stops notifications", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDictionarySources(listener);
    unsubscribe();
    registerDictionarySource(contribution());
    expect(listener).not.toHaveBeenCalled();
  });

  it("returns a stable snapshot between changes", () => {
    registerDictionarySource(contribution());
    expect(listDictionarySources()).toBe(listDictionarySources());
  });
});
