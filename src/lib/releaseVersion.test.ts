import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Both error reporters tag events `<name>@<version>`: the frontend from
// package.json, the Rust one from Cargo.toml. If those drift, one build shows up
// as two releases and resolving an issue in a given release silently stops working.
describe("the release", () => {
  it("has the same name and version in package.json and Cargo.toml", async () => {
    // Vitest runs from the project root, so both files are reachable from cwd.
    const pkg = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8")) as {
      name: string;
      version: string;
    };
    const cargo = await readFile(join(process.cwd(), "src-tauri/Cargo.toml"), "utf8");

    expect(/^name\s*=\s*"([^"]+)"/m.exec(cargo)?.[1]).toBe(pkg.name);
    expect(/^version\s*=\s*"([^"]+)"/m.exec(cargo)?.[1]).toBe(pkg.version);
  });
});
