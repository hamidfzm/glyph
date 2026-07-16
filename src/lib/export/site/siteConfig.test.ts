import { describe, expect, it } from "vitest";
import { parseSiteConfig, resolveConfigAsset, robotsTxt } from "./siteConfig";

describe("parseSiteConfig", () => {
  it("keeps an already-trailing slash on baseUrl unchanged", () => {
    const config = parseSiteConfig(JSON.stringify({ baseUrl: "https://example.com/" }), "n");
    expect(config.baseUrl).toBe("https://example.com/");
  });

  it("defaults everything when the workspace has no config", () => {
    expect(parseSiteConfig(null, "notes")).toEqual({
      title: "notes",
      description: "",
      baseUrl: null,
      favicon: null,
      socialImage: null,
      robots: null,
      theme: "github",
    });
  });

  it("parses a full config and normalizes the base URL", () => {
    const config = parseSiteConfig(
      JSON.stringify({
        title: "My Site",
        description: "Notes about things",
        baseUrl: "https://example.com/notes",
        favicon: "assets/logo.png",
        socialImage: "assets/card.png",
        robots: "all",
      }),
      "notes",
    );
    expect(config.title).toBe("My Site");
    expect(config.description).toBe("Notes about things");
    expect(config.baseUrl).toBe("https://example.com/notes/");
    expect(config.favicon).toBe("assets/logo.png");
    expect(config.socialImage).toBe("assets/card.png");
    expect(config.robots).toBe("all");
  });

  it("fills defaults for omitted fields", () => {
    const config = parseSiteConfig('{"title": "T"}', "notes");
    expect(config.title).toBe("T");
    expect(config.baseUrl).toBeNull();
    expect(config.robots).toBeNull();
    expect(config.theme).toBe("github");
  });

  it("passes a configured theme id through for the exporter to validate", () => {
    expect(parseSiteConfig('{"theme": "solarized"}', "notes").theme).toBe("solarized");
    expect(() => parseSiteConfig('{"theme": ""}', "notes")).toThrow(/"theme" must be/);
  });

  it("rejects invalid JSON with the file name in the message", () => {
    expect(() => parseSiteConfig("{nope", "notes")).toThrow(
      /\.glyph\/site\.json is not valid JSON/,
    );
  });

  it("rejects non-object roots and wrong field types", () => {
    expect(() => parseSiteConfig("[1]", "notes")).toThrow(/must contain a JSON object/);
    expect(() => parseSiteConfig('{"title": 3}', "notes")).toThrow(/"title" must be/);
    expect(() => parseSiteConfig('{"favicon": ""}', "notes")).toThrow(/"favicon" must be/);
    expect(() => parseSiteConfig('{"robots": "some"}', "notes")).toThrow(
      /"robots" must be "all" or "none"/,
    );
    expect(() => parseSiteConfig('{"baseUrl": "ftp://x.com"}', "notes")).toThrow(
      /http\(s\) URL with a host/,
    );
    expect(() => parseSiteConfig('{"baseUrl": "https://"}', "notes")).toThrow(/valid URL|host/);
    expect(() => parseSiteConfig('{"baseUrl": "not a url"}', "notes")).toThrow(/valid URL/);
  });

  it("rejects a social image without a base URL to point at it", () => {
    expect(() => parseSiteConfig('{"socialImage": "card.png"}', "notes")).toThrow(
      /"socialImage" requires "baseUrl"/,
    );
  });
});

describe("resolveConfigAsset", () => {
  it("resolves nested workspace paths to source and site locations", () => {
    expect(resolveConfigAsset("/ws", "assets/logo.png", "favicon")).toEqual({
      abs: "/ws/assets/logo.png",
      siteRel: "assets/logo.png",
    });
  });

  it("collapses dot segments that stay inside the workspace", () => {
    expect(resolveConfigAsset("/ws", "./assets/../logo.png", "favicon").siteRel).toBe("logo.png");
  });

  it("rejects paths that escape the workspace", () => {
    // The config can come from an untrusted repo: a traversal must never
    // become a read outside the root or a write outside the output dir.
    expect(() => resolveConfigAsset("/ws", "../secrets.env", "favicon")).toThrow(
      /"favicon" must stay inside the workspace/,
    );
    expect(() => resolveConfigAsset("/ws", "a/../../../etc/passwd", "socialImage")).toThrow(
      /"socialImage" must stay inside the workspace/,
    );
  });
});

describe("robotsTxt", () => {
  it("allows or disallows everything", () => {
    expect(robotsTxt("all")).toBe("User-agent: *\nAllow: /\n");
    expect(robotsTxt("none")).toBe("User-agent: *\nDisallow: /\n");
  });
});
