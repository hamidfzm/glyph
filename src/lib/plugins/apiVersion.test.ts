import { describe, expect, it } from "vitest";
import { PLUGIN_API_VERSION, satisfiesApiVersion } from "./apiVersion";

describe("satisfiesApiVersion", () => {
  it("matches an exact version", () => {
    expect(satisfiesApiVersion("1.0.0", "1.0.0")).toBe(true);
    expect(satisfiesApiVersion("1.0.1", "1.0.0")).toBe(false);
  });

  it("accepts a caret range with a higher host patch or minor", () => {
    expect(satisfiesApiVersion("^1.0.0", "1.0.5")).toBe(true);
    expect(satisfiesApiVersion("^1.2.0", "1.4.0")).toBe(true);
  });

  it("rejects a caret range the host is below", () => {
    expect(satisfiesApiVersion("^1.2.0", "1.1.9")).toBe(false);
    expect(satisfiesApiVersion("^1.0.5", "1.0.4")).toBe(false);
  });

  it("rejects a different major version", () => {
    expect(satisfiesApiVersion("^1.0.0", "2.0.0")).toBe(false);
    expect(satisfiesApiVersion("^2.0.0", "1.9.9")).toBe(false);
  });

  it("treats unparseable input as incompatible", () => {
    expect(satisfiesApiVersion("latest", "1.0.0")).toBe(false);
    expect(satisfiesApiVersion("^1.0", "1.0.0")).toBe(false);
    expect(satisfiesApiVersion("^1.0.0", "nope")).toBe(false);
  });

  it("defaults the host to the current API version", () => {
    expect(satisfiesApiVersion(`^${PLUGIN_API_VERSION}`)).toBe(true);
  });
});
