import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./settings";
import { deepMerge, isSafePlainObject, setNestedValue } from "./settingsObject";

describe("isSafePlainObject", () => {
  it("accepts plain object literals", () => {
    expect(isSafePlainObject({})).toBe(true);
    expect(isSafePlainObject({ a: 1 })).toBe(true);
  });

  it("accepts null-prototype objects", () => {
    expect(isSafePlainObject(Object.create(null))).toBe(true);
  });

  it("rejects null, primitives, and arrays", () => {
    expect(isSafePlainObject(null)).toBe(false);
    expect(isSafePlainObject(undefined)).toBe(false);
    expect(isSafePlainObject(42)).toBe(false);
    expect(isSafePlainObject("str")).toBe(false);
    expect(isSafePlainObject([])).toBe(false);
  });

  it("rejects Object.prototype itself", () => {
    expect(isSafePlainObject(Object.prototype)).toBe(false);
  });

  it("rejects class instances (custom prototype)", () => {
    class Foo {}
    expect(isSafePlainObject(new Foo())).toBe(false);
  });
});

describe("deepMerge", () => {
  it("overlays source scalars onto target", () => {
    expect(deepMerge({ a: 1, b: 2 }, { b: 3 })).toEqual({ a: 1, b: 3 });
  });

  it("recurses into nested plain objects", () => {
    expect(deepMerge({ a: { x: 1, y: 2 } }, { a: { y: 9 } })).toEqual({ a: { x: 1, y: 9 } });
  });

  it("replaces (does not merge) when types differ", () => {
    expect(deepMerge({ a: { x: 1 } }, { a: "scalar" })).toEqual({ a: "scalar" });
  });

  it("skips forbidden own keys on the source", () => {
    // Computed key creates an own enumerable "__proto__" property rather than
    // setting the prototype, so deepMerge must explicitly skip it.
    const malicious = { ["__proto__"]: { polluted: true }, safe: 1 };
    const result = deepMerge({ safe: 0 }, malicious);
    expect(result.safe).toBe(1);
    // biome-ignore lint/suspicious/noExplicitAny: probing the prototype chain
    expect(({} as any).polluted).toBeUndefined();
    expect(Object.hasOwn(result, "polluted")).toBe(false);
  });
});

describe("setNestedValue", () => {
  const base = () => structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>;

  it("sets a one-level value, returning a new object", () => {
    const obj = base();
    const result = setNestedValue(obj, "appearance", { theme: "dark" });
    expect(result).not.toBe(obj);
    expect(result.appearance).toEqual({ theme: "dark" });
  });

  it("sets a nested value without mutating the input", () => {
    const obj = base();
    const result = setNestedValue(obj, "appearance.theme", "dark");
    expect((result.appearance as Record<string, unknown>).theme).toBe("dark");
    expect((obj.appearance as Record<string, unknown>).theme).toBe("system");
  });

  it("returns the input unchanged for an empty path or empty segment", () => {
    const obj = base();
    expect(setNestedValue(obj, "", true)).toBe(obj);
    expect(setNestedValue(obj, "appearance..theme", true)).toBe(obj);
  });

  it("rejects a forbidden intermediate key", () => {
    const obj = base();
    expect(setNestedValue(obj, "__proto__.polluted", true)).toBe(obj);
  });

  it("rejects a forbidden final key", () => {
    const obj = base();
    expect(setNestedValue(obj, "appearance.__proto__", true)).toBe(obj);
  });

  it("rejects an unknown top-level key", () => {
    const obj = base();
    expect(setNestedValue(obj, "bogus.x", true)).toBe(obj);
  });

  it("rejects an unknown nested key", () => {
    const obj = base();
    expect(setNestedValue(obj, "appearance.bogus", true)).toBe(obj);
  });

  it("rejects descending through a scalar schema node", () => {
    // fontSize is a number in the schema, so "appearance.fontSize.x" must stop.
    const obj = base();
    expect(setNestedValue(obj, "appearance.fontSize.x", 1)).toBe(obj);
  });

  it("rebuilds intermediates when the current node is not a plain object", () => {
    // Simulates a malformed persisted state where `ai` was replaced by a scalar.
    // The allowlist still permits ai.apiKeys; the writer rebuilds the missing
    // objects rather than reading through the scalar.
    const obj = { ...base(), ai: "broken" } as Record<string, unknown>;
    const result = setNestedValue(obj, "ai.apiKeys", { k: "v" });
    expect(result.ai).toEqual({ apiKeys: { k: "v" } });
  });

  it("rebuilds a missing intermediate then rejects at an empty-schema leaf", () => {
    // `ai` is a scalar (rebuilt to {}) and `apiKeys` is therefore absent on the
    // rebuilt node; descent continues but the empty apiKeys schema has no `foo`
    // key, so the write is rejected and the original object is returned intact.
    const obj = { ...base(), ai: "broken" } as Record<string, unknown>;
    expect(setNestedValue(obj, "ai.apiKeys.foo", "v")).toBe(obj);
  });
});
