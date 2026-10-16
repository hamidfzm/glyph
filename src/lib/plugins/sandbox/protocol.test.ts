import { describe, expect, it } from "vitest";
import { isNetworkAllowed } from "./protocol";

describe("isNetworkAllowed", () => {
  it("allows the declared host and its subdomains", () => {
    const perms = ["workspace:read", "network:example.com"];
    expect(isNetworkAllowed(perms, "https://example.com/x")).toBe(true);
    expect(isNetworkAllowed(perms, "https://api.example.com/x")).toBe(true);
    expect(isNetworkAllowed(perms, "http://api.example.com/x")).toBe(true);
  });

  it("rejects other hosts, lookalikes, and invalid URLs", () => {
    const perms = ["network:example.com"];
    expect(isNetworkAllowed(perms, "https://evil.com/")).toBe(false);
    expect(isNetworkAllowed(perms, "https://notexample.com/")).toBe(false);
    expect(isNetworkAllowed(perms, "https://example.com.evil.net/")).toBe(false);
    expect(isNetworkAllowed(perms, "not a url")).toBe(false);
  });

  it("rejects everything when no network permission is declared", () => {
    expect(isNetworkAllowed([], "https://example.com/")).toBe(false);
    expect(isNetworkAllowed(["workspace:read"], "https://example.com/")).toBe(false);
  });

  it("reads a trailing dot and letter case as the same host, and an empty host as none", () => {
    expect(isNetworkAllowed(["network:Example.COM."], "https://API.example.com./x")).toBe(true);
    expect(isNetworkAllowed(["network:"], "https://evil.com./x")).toBe(false);
    expect(isNetworkAllowed(["network:"], "https://evil.com/x")).toBe(false);
  });

  it("never covers the webview's own hosts or another scheme", () => {
    const perms = ["network:localhost", "network:asset.localhost"];
    expect(isNetworkAllowed(perms, "http://localhost:11434/api/tags")).toBe(true);
    for (const url of [
      "http://asset.localhost/%2Fhome%2Fme%2F.env",
      "https://asset.localhost/x",
      "asset://localhost/x",
      "http://ipc.localhost/read_file",
      "http://tauri.localhost/",
      "ws://localhost/",
      "file:///etc/passwd",
    ]) {
      expect(isNetworkAllowed(perms, url), url).toBe(false);
    }
  });
});
