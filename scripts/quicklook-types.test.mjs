import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file) => readFileSync(path.join(import.meta.dirname, "..", "src-tauri", file), "utf8");
// macOS itself types these as net.daringfireball.markdown.
const SYSTEM_TYPED = ["md", "markdown"];

const strings = (xml) => [...xml.matchAll(/<string>([^<]*)<\/string>/g)].map((match) => match[1]);
const arrayAfter = (xml, key) =>
  strings(xml.match(new RegExp(`<key>${key}</key>\\s*<array>([\\s\\S]*?)</array>`))?.[1] ?? "");

const appPlist = read("Info.plist");
const extensionPlist = read("macos/quicklook/Info.plist");
const markdown = JSON.parse(read("tauri.conf.json")).bundle.fileAssociations.find(
  (association) => association.mimeType === "text/markdown",
).ext;

describe("Quick Look content types", () => {
  it("Glyph's markdown type covers every markdown extension the system does not", () => {
    const declared = arrayAfter(appPlist, "public.filename-extension");
    expect([...SYSTEM_TYPED, ...declared].sort()).toEqual([...markdown].sort());
  });

  it("the extension previews the system's markdown type and Glyph's own", () => {
    const identifier = appPlist.match(/<key>UTTypeIdentifier<\/key>\s*<string>([^<]+)</)?.[1];
    expect(arrayAfter(extensionPlist, "QLSupportedContentTypes")).toEqual([
      "net.daringfireball.markdown",
      identifier,
    ]);
  });
});
