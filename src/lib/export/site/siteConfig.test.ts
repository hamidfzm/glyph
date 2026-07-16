import { describe, expect, it } from "vitest";
import { parseSiteConfig, robotsTxt } from "./siteConfig";

describe("parseSiteConfig", () => {
  it("defaults everything when the workspace has no config", () => {
    expect(parseSiteConfig(null, "notes")).toEqual({
      title: "notes",
      description: "",
      baseUrl: null,
      favicon: null,
      socialImage: null,
      robots: null,
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
  });

  it("rejects invalid JSON with the file name in the message", () => {
    expect(() => parseSiteConfig("{nope", "notes")).toThrow(/glyph-site\.json is not valid JSON/);
  });

  it("rejects non-object roots and wrong field types", () => {
    expect(() => parseSiteConfig("[1]", "notes")).toThrow(/must contain a JSON object/);
    expect(() => parseSiteConfig('{"title": 3}', "notes")).toThrow(/"title" must be/);
    expect(() => parseSiteConfig('{"favicon": ""}', "notes")).toThrow(/"favicon" must be/);
    expect(() => parseSiteConfig('{"robots": "some"}', "notes")).toThrow(
      /"robots" must be "all" or "none"/,
    );
    expect(() => parseSiteConfig('{"baseUrl": "ftp://x"}', "notes")).toThrow(/http\(s\):\/\//);
  });
});

describe("robotsTxt", () => {
  it("allows or disallows everything", () => {
    expect(robotsTxt("all")).toBe("User-agent: *\nAllow: /\n");
    expect(robotsTxt("none")).toBe("User-agent: *\nDisallow: /\n");
  });
});
