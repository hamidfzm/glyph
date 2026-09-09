import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The frontend error reporter tags events `glyph@<package.json version>` and the
// Rust one `glyph@<Cargo.toml version>`. If those drift, one build shows up as
// two releases and resolving an issue in a given release silently stops working.
describe("the release version", () => {
  it("is the same in package.json and Cargo.toml", async () => {
    // Vitest runs from the project root, so both files are reachable from cwd.
    const pkg = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8")) as {
      version: string;
    };
    const cargo = await readFile(join(process.cwd(), "src-tauri/Cargo.toml"), "utf8");

    expect(/^version\s*=\s*"([^"]+)"/m.exec(cargo)?.[1]).toBe(pkg.version);
  });
});
