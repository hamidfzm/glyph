import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file) => readFileSync(path.join(import.meta.dirname, "..", file), "utf8");
const execArguments = (entry) => entry.match(/^Exec=\S+(.*)$/m)?.[1].trim();
const mimeTypes = (entry) => entry.match(/^MimeType=(.*)$/m)[1].split(";").filter(Boolean);

const { linux, fileAssociations } = JSON.parse(read("src-tauri/tauri.conf.json")).bundle;
const template = read(`src-tauri/${linux.deb.desktopTemplate}`);
const flatpak = read("flatpak/com.hamidfzm.glyph.desktop");
const extensionsOf = (mimeType) =>
  fileAssociations.find((association) => association.mimeType === mimeType).ext;

const MIME_PACKAGE = "linux/glyph.xml";
const mimePackage = read(`src-tauri/${MIME_PACKAGE}`);
const globs = (xml) => [...xml.matchAll(/<glob pattern="\*\.([^"]+)"\/>/g)].map((glob) => glob[1]);
const declared = [...mimePackage.matchAll(/<mime-type type="([^"]+)">([\s\S]*?)<\/mime-type>/g)];
// Each type the package defines, with the extensions its globs cover.
const globbed = Object.fromEntries(declared.map(([, type, body]) => [type, globs(body)]));

describe("Linux desktop entry", () => {
  // GNOME leaves an app out of "Open With" when Exec takes no file argument.
  it("takes file arguments", () => {
    expect(execArguments(template)).toBe("%F");
  });

  it("is the same entry in the .rpm as in the .deb", () => {
    expect(linux.rpm.desktopTemplate).toBe(linux.deb.desktopTemplate);
  });

  it("takes files the same way in the Flatpak entry", () => {
    expect(execArguments(flatpak)).toBe(execArguments(template));
  });

  // text/plain is every text file, and Glyph refuses all but its own.
  it("claims the types the MIME package defines and no others", () => {
    expect(mimeTypes(template).sort()).toEqual(Object.keys(globbed).sort());
  });

  it("claims no type in the Flatpak entry that the packages do not", () => {
    expect(mimeTypes(template)).toEqual(expect.arrayContaining(mimeTypes(flatpak)));
  });
});

describe("Linux MIME package", () => {
  // The Linux type on the left stands in for the association keyed on the right.
  it.each([
    ["text/markdown", "text/markdown"],
    ["text/x-d2", "text/plain"],
  ])("types as %s every extension of the %s association", (type, association) => {
    expect([...globbed[type]].sort()).toEqual([...extensionsOf(association)].sort());
  });

  // A glob spelled any other way (a weight, a literal name) escapes the comparison above.
  it("declares nothing but plain extension globs", () => {
    expect(mimePackage.match(/<glob\b/g)).toHaveLength(Object.values(globbed).flat().length);
  });

  it("is installed by the .deb, the .rpm and the AppImage alike", () => {
    expect(linux.deb.files).toEqual({ "/usr/share/mime/packages/glyph.xml": MIME_PACKAGE });
    expect(linux.rpm.files).toEqual(linux.deb.files);
    expect(linux.appimage.files).toEqual(linux.deb.files);
  });
});
