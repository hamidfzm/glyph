import { describe, expect, it } from "vitest";
import { isNetworkAllowed } from "./protocol";

describe("isNetworkAllowed", () => {
  it("allows the declared host and its subdomains", () => {
    const perms = ["workspace:read", "network:example.com"];
    expect(isNetworkAllowed(perms, "https://example.com/x")).toBe(true);
    expect(isNetworkAllowed(perms, "https://api.example.com/x")).toBe(true);
  });

  it("rejects other hosts, lookalikes, and invalid URLs", () => {
    const perms = ["network:example.com"];
    expect(isNetworkAllowed(perms, "https://evil.com/")).toBe(false);
    expect(isNetworkAllowed(perms, "https://notexample.com/")).toBe(false);
    expect(isNetworkAllowed(perms, "not a url")).toBe(false);
  });

  it("rejects everything when no network permission is declared", () => {
    expect(isNetworkAllowed([], "https://example.com/")).toBe(false);
    expect(isNetworkAllowed(["workspace:read"], "https://example.com/")).toBe(false);
  });
});
