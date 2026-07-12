import { describe, expect, it } from "vitest";
import {
  decodeHref,
  encodeHref,
  headingSlug,
  indexSourcePriority,
  pageRelPath,
  relativeHref,
  relFromRoot,
  toPosix,
} from "./sitePaths";

describe("toPosix", () => {
  it("converts backslashes to forward slashes", () => {
    expect(toPosix("C:\\ws\\guide\\intro.md")).toBe("C:/ws/guide/intro.md");
  });

  it("leaves POSIX paths untouched", () => {
    expect(toPosix("/ws/guide/intro.md")).toBe("/ws/guide/intro.md");
  });
});

describe("relFromRoot", () => {
  it("strips the root prefix (POSIX)", () => {
    expect(relFromRoot("/ws", "/ws/guide/intro.md")).toBe("guide/intro.md");
  });

  it("strips the root prefix (Windows separators)", () => {
    expect(relFromRoot("C:\\ws", "C:\\ws\\guide\\intro.md")).toBe("guide/intro.md");
  });

  it("tolerates a trailing separator on the root", () => {
    expect(relFromRoot("/ws/", "/ws/notes.md")).toBe("notes.md");
  });

  it("falls back to the basename for paths outside the root", () => {
    expect(relFromRoot("/ws", "/elsewhere/pic.png")).toBe("pic.png");
  });
});

describe("pageRelPath", () => {
  it("maps markdown to .html preserving folders", () => {
    expect(pageRelPath("guide/intro.md")).toBe("guide/intro.html");
    expect(pageRelPath("notes.markdown")).toBe("notes.html");
    expect(pageRelPath("README.md")).toBe("README.html");
  });
});

describe("indexSourcePriority", () => {
  it("ranks a root index above a root README, regardless of case", () => {
    expect(indexSourcePriority("index.md")).toBeGreaterThan(indexSourcePriority("README.md"));
    expect(indexSourcePriority("Index.markdown")).toBe(indexSourcePriority("index.md"));
    expect(indexSourcePriority("readme.mdown")).toBe(indexSourcePriority("README.md"));
    expect(indexSourcePriority("README.md")).toBeGreaterThan(0);
  });

  it("gives ordinary and nested pages no claim on index.html", () => {
    expect(indexSourcePriority("notes.md")).toBe(0);
    expect(indexSourcePriority("docs/index.md")).toBe(0);
    expect(indexSourcePriority("docs/README.md")).toBe(0);
  });
});

describe("relativeHref", () => {
  it("links between siblings", () => {
    expect(relativeHref("a.html", "b.html")).toBe("b.html");
  });

  it("links down into a folder", () => {
    expect(relativeHref("index.html", "guide/intro.html")).toBe("guide/intro.html");
  });

  it("links up out of a folder", () => {
    expect(relativeHref("guide/intro.html", "index.html")).toBe("../index.html");
  });

  it("links across folders keeping the common prefix", () => {
    expect(relativeHref("a/b/c.html", "a/d/e.html")).toBe("../d/e.html");
  });

  it("reaches shared assets from a nested page", () => {
    expect(relativeHref("guide/intro.html", "style.css")).toBe("../style.css");
  });
});

describe("decodeHref", () => {
  it("undoes percent-encoding", () => {
    expect(decodeHref("my%20pics/a%20b.png")).toBe("my pics/a b.png");
  });

  it("passes malformed sequences through verbatim", () => {
    expect(decodeHref("50%-off.md")).toBe("50%-off.md");
  });
});

describe("encodeHref", () => {
  it("percent-encodes spaces per segment but keeps .. and slashes", () => {
    expect(encodeHref("../my notes/a b.html")).toBe("../my%20notes/a%20b.html");
  });
});

describe("headingSlug", () => {
  it("matches rehype-slug's github-slugger ids", () => {
    expect(headingSlug("Getting Started")).toBe("getting-started");
    expect(headingSlug("FAQ & Tips")).toBe("faq--tips");
  });
});
