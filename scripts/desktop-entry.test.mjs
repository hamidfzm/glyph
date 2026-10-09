import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file) => readFileSync(path.join(import.meta.dirname, "..", file), "utf8");
const execArguments = (entry) => entry.match(/^Exec=\S+(.*)$/m)?.[1].trim();

const { linux } = JSON.parse(read("src-tauri/tauri.conf.json")).bundle;
const template = read(`src-tauri/${linux.deb.desktopTemplate}`);

describe("Linux desktop entry", () => {
  // GNOME leaves an app out of "Open With" when Exec takes no file argument.
  it("takes file arguments", () => {
    expect(execArguments(template)).toBe("%F");
  });

  it("is the same entry in the .rpm as in the .deb", () => {
    expect(linux.rpm.desktopTemplate).toBe(linux.deb.desktopTemplate);
  });

  it("takes files the same way in the Flatpak entry", () => {
    expect(execArguments(read("flatpak/com.hamidfzm.glyph.desktop"))).toBe(
      execArguments(template),
    );
  });
});
