import { describe, expect, it } from "vitest";
import { PLUGIN_API_COMPAT_FLOOR, PLUGIN_API_VERSION, satisfiesApiVersion } from "./apiVersion";

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

  it("accepts declared versions inside the compatibility window while major is 0", () => {
    expect(satisfiesApiVersion("0.16.0", "0.17.0", "0.16.0")).toBe(true);
    expect(satisfiesApiVersion("0.17.0", "0.17.0", "0.16.0")).toBe(true);
    expect(satisfiesApiVersion("0.16.5", "0.17.0", "0.16.0")).toBe(true);
  });

  it("older plugins keep loading on any later host while the floor holds", () => {
    // The forward guarantee: additive API bumps (and app releases, which the
    // gate never sees) do not evict plugins; only a floor move does.
    expect(satisfiesApiVersion("0.16.0", "0.18.0", "0.16.0")).toBe(true);
    expect(satisfiesApiVersion("0.16.0", "0.20.0", "0.16.0")).toBe(true);
    expect(satisfiesApiVersion("0.17.0", "0.20.0", "0.16.0")).toBe(true);
    expect(satisfiesApiVersion("0.16.0", "0.20.0", "0.17.0")).toBe(false); // floor moved past it
  });

  it("rejects declared versions outside the window while major is 0", () => {
    expect(satisfiesApiVersion("0.15.9", "0.17.0", "0.16.0")).toBe(false); // below the floor
    expect(satisfiesApiVersion("0.18.0", "0.17.0", "0.16.0")).toBe(false); // newer than the host
    expect(satisfiesApiVersion("0.16.0", "0.15.9", "0.15.0")).toBe(false); // newer than the host
  });

  it("a caret adds nothing below major 1", () => {
    expect(satisfiesApiVersion("^0.16.0", "0.17.0", "0.16.0")).toBe(true); // same as exact
    expect(satisfiesApiVersion("^0.15.0", "0.17.0", "0.16.0")).toBe(false);
    expect(satisfiesApiVersion("^0.16.0", "1.0.0")).toBe(false); // major differs
  });

  it("treats an unparseable floor as incompatible", () => {
    expect(satisfiesApiVersion("0.16.0", "0.17.0", "not-a-version")).toBe(false);
  });

  it("a floor from a different major rejects instead of matching accidentally", () => {
    expect(satisfiesApiVersion("0.16.0", "0.17.0", "1.0.0")).toBe(false);
  });

  it("defaults the floor to the shipped compatibility floor", () => {
    expect(satisfiesApiVersion(PLUGIN_API_COMPAT_FLOOR)).toBe(true);
    expect(satisfiesApiVersion("0.1.0")).toBe(false);
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
