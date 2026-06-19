import { afterEach, describe, expect, it, vi } from "vitest";
import { injectedOpen, isPrimaryWindow } from "./windowContext";

type Injectable = {
  __GLYPH_OPEN__?: unknown;
  __GLYPH_PRIMARY__?: unknown;
};

afterEach(() => {
  const g = window as unknown as Injectable;
  g.__GLYPH_OPEN__ = undefined;
  g.__GLYPH_PRIMARY__ = undefined;
});

describe("windowContext", () => {
  it("injectedOpen returns null when nothing is injected", () => {
    expect(injectedOpen()).toBeNull();
  });

  it("injectedOpen returns a valid folder or file payload", () => {
    (window as unknown as Injectable).__GLYPH_OPEN__ = { kind: "folder", path: "/p/ws" };
    expect(injectedOpen()).toEqual({ kind: "folder", path: "/p/ws" });
    (window as unknown as Injectable).__GLYPH_OPEN__ = { kind: "file", path: "/p/a.md" };
    expect(injectedOpen()).toEqual({ kind: "file", path: "/p/a.md" });
  });

  it("injectedOpen rejects malformed payloads", () => {
    const g = window as unknown as Injectable;
    g.__GLYPH_OPEN__ = { kind: "bogus", path: "/p" };
    expect(injectedOpen()).toBeNull();
    g.__GLYPH_OPEN__ = { kind: "file", path: "" };
    expect(injectedOpen()).toBeNull();
    g.__GLYPH_OPEN__ = { kind: "file" };
    expect(injectedOpen()).toBeNull();
  });

  it("isPrimaryWindow is true unless explicitly marked false", () => {
    expect(isPrimaryWindow()).toBe(true);
    (window as unknown as Injectable).__GLYPH_PRIMARY__ = false;
    expect(isPrimaryWindow()).toBe(false);
    (window as unknown as Injectable).__GLYPH_PRIMARY__ = true;
    expect(isPrimaryWindow()).toBe(true);
  });

  it("degrades gracefully when there is no window (SSR guard)", () => {
    vi.stubGlobal("window", undefined);
    try {
      expect(injectedOpen()).toBeNull();
      expect(isPrimaryWindow()).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
