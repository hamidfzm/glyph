import { describe, expect, it } from "vitest";
import { editorKeymapExtensions } from "./editorKeymap";

describe("editorKeymapExtensions", () => {
  it("adds nothing for the default preset", () => {
    const { leading, extraKeys } = editorKeymapExtensions("default");
    expect(leading).toHaveLength(0);
    expect(extraKeys).toHaveLength(0);
  });

  it("installs Vim as a leading extension", () => {
    const { leading, extraKeys } = editorKeymapExtensions("vim");
    expect(leading.length).toBeGreaterThan(0);
    expect(extraKeys).toHaveLength(0);
  });

  it("supplies VSCode bindings as extra keys", () => {
    const { leading, extraKeys } = editorKeymapExtensions("vscode");
    expect(leading).toHaveLength(0);
    expect(extraKeys.length).toBeGreaterThan(0);
  });
});
