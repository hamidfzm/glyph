import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSpellcheckEngines,
  getSpellcheckEngine,
  registerSpellcheckEngine,
  type SpellcheckEngine,
  subscribeSpellcheckEngine,
} from "./spellcheckEngines";

function engine(): SpellcheckEngine {
  return { create: vi.fn() };
}

describe("spell-check engine registry", () => {
  beforeEach(() => clearSpellcheckEngines());

  it("has no engine until one registers", () => {
    expect(getSpellcheckEngine()).toBeUndefined();
  });

  it("uses the latest registration and brings back the previous one when it goes", () => {
    const first = engine();
    const second = engine();
    registerSpellcheckEngine(first);
    const removeSecond = registerSpellcheckEngine(second);
    expect(getSpellcheckEngine()).toBe(second);

    removeSecond();
    expect(getSpellcheckEngine()).toBe(first);
  });

  it("notifies only when the active engine changes", () => {
    const listener = vi.fn();
    subscribeSpellcheckEngine(listener);
    const removeFirst = registerSpellcheckEngine(engine());
    const removeSecond = registerSpellcheckEngine(engine());
    expect(listener).toHaveBeenCalledTimes(2);

    removeFirst();
    expect(listener).toHaveBeenCalledTimes(2);
    removeSecond();
    expect(listener).toHaveBeenCalledTimes(3);
    expect(getSpellcheckEngine()).toBeUndefined();
  });

  it("ignores a disposer called twice", () => {
    const listener = vi.fn();
    const remove = registerSpellcheckEngine(engine());
    subscribeSpellcheckEngine(listener);
    remove();
    remove();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("stops notifying an unsubscribed listener", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSpellcheckEngine(listener);
    unsubscribe();
    registerSpellcheckEngine(engine());
    expect(listener).not.toHaveBeenCalled();
  });
});
