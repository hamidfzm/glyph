import { describe, expect, it } from "vitest";
import {
  associationExtensions,
  CANVAS_EXTENSIONS,
  D2_EXTENSIONS,
  declaredExtensions,
  hasExtension,
  IMAGE_EXTENSIONS,
  MARKDOWN_EXTENSIONS,
  MEDIA_EXTENSIONS,
  NOTEBOOK_EXTENSIONS,
  USER_FILE_EXTENSIONS,
} from "./extensionConfig";

describe("associationExtensions", () => {
  const config = {
    bundle: {
      fileAssociations: [
        { ext: ["md", "mmd"], mimeType: "text/markdown" },
        { ext: ["d2"], mimeType: "text/plain" },
      ],
    },
  };

  it("returns the ext array of the entry carrying the mime type", () => {
    expect(associationExtensions(config, "text/markdown")).toEqual(["md", "mmd"]);
    expect(associationExtensions(config, "text/plain")).toEqual(["d2"]);
  });

  it("throws when no entry carries the mime type", () => {
    expect(() => associationExtensions(config, "text/nope")).toThrow(/found 0/);
  });

  it("throws when two entries claim the same mime type", () => {
    const ambiguous = {
      bundle: {
        fileAssociations: [
          { ext: ["a"], mimeType: "text/plain" },
          { ext: ["b"], mimeType: "text/plain" },
        ],
      },
    };
    expect(() => associationExtensions(ambiguous, "text/plain")).toThrow(/found 2/);
  });

  it("throws when bundle or fileAssociations is missing", () => {
    expect(() => associationExtensions({}, "text/markdown")).toThrow(/found 0/);
    expect(() => associationExtensions({ bundle: {} }, "text/markdown")).toThrow(/found 0/);
  });

  it("throws when ext is missing, not an array, or empty", () => {
    const bad = (ext: unknown) => ({
      bundle: { fileAssociations: [{ ext, mimeType: "text/markdown" }] },
    });
    expect(() => associationExtensions(bad(undefined), "text/markdown")).toThrow(
      /single source of truth/,
    );
    expect(() => associationExtensions(bad("md"), "text/markdown")).toThrow(
      /single source of truth/,
    );
    expect(() => associationExtensions(bad([]), "text/markdown")).toThrow(/single source of truth/);
    expect(() => associationExtensions(bad([1]), "text/markdown")).toThrow(
      /single source of truth/,
    );
  });
});

describe("declaredExtensions", () => {
  it("returns the array declared under the key", () => {
    expect(declaredExtensions({ canvas: ["canvas"] }, "canvas")).toEqual(["canvas"]);
  });

  it("throws when the key is missing or malformed", () => {
    expect(() => declaredExtensions({}, "canvas")).toThrow(/single source of truth/);
    expect(() => declaredExtensions({ canvas: [] }, "canvas")).toThrow(/single source of truth/);
    expect(() => declaredExtensions({ canvas: [""] }, "canvas")).toThrow(/single source of truth/);
  });
});

describe("hasExtension", () => {
  it("matches case-insensitively on the last segment", () => {
    expect(hasExtension("notes.MD", ["md"])).toBe(true);
    expect(hasExtension("a.b.c.md", ["md"])).toBe(true);
    expect(hasExtension("README.md.bak", ["md"])).toBe(false);
  });

  it("rejects paths with no extension segment", () => {
    expect(hasExtension("Makefile", ["md"])).toBe(false);
    expect(hasExtension("", ["md"])).toBe(false);
  });

  it("treats a leading dot as a dotfile, not an extension", () => {
    // Matches Rust's Path::extension, which the backend gate uses. A file named
    // ".md" is a dotfile; the frontend must not call it markdown when the
    // backend will not.
    expect(hasExtension(".md", ["md"])).toBe(false);
    expect(hasExtension("/a/b/.md", ["md"])).toBe(false);
    expect(hasExtension(".hidden.md", ["md"])).toBe(true);
  });

  it("ignores dots in parent directories", () => {
    expect(hasExtension("a.md/notes", ["md"])).toBe(false);
  });
});

describe("the configured lists", () => {
  it("come from the shipped config files", () => {
    expect(MARKDOWN_EXTENSIONS).toContain("md");
    expect(D2_EXTENSIONS).toEqual(["d2"]);
    expect(CANVAS_EXTENSIONS).toEqual(["canvas"]);
    expect(NOTEBOOK_EXTENSIONS).toEqual(["ipynb"]);
    expect(IMAGE_EXTENSIONS).toContain("png");
    expect(MEDIA_EXTENSIONS).toContain("mp4");
  });

  it("are all present in USER_FILE_EXTENSIONS", () => {
    for (const list of [
      MARKDOWN_EXTENSIONS,
      D2_EXTENSIONS,
      CANVAS_EXTENSIONS,
      NOTEBOOK_EXTENSIONS,
      IMAGE_EXTENSIONS,
      MEDIA_EXTENSIONS,
    ]) {
      for (const ext of list) {
        expect(USER_FILE_EXTENSIONS).toContain(ext);
      }
    }
  });

  it("contain no source-code extension", () => {
    // The telemetry redaction matches any name ending in one of these, so a
    // source extension here would start redacting stack frames.
    for (const ext of ["rs", "ts", "tsx", "js", "json"]) {
      expect(USER_FILE_EXTENSIONS).not.toContain(ext);
    }
  });
});
