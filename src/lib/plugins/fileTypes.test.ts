import { afterEach, describe, expect, it } from "vitest";
import type { Disposer } from "./disposer";
import { fileTypeFor, fileTypes, registerFileType } from "./fileTypes";

const disposers: Disposer[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

function register(extensions: string[], language: string) {
  disposers.push(registerFileType({ extensions, language }));
}

describe("fileTypes", () => {
  it("matches a registered extension without the dot, ignoring case", () => {
    register([".PUML", "plantuml"], "plantuml");

    expect(fileTypeFor("/ws/Diagram.puml")).toEqual({
      extensions: ["puml", "plantuml"],
      language: "plantuml",
    });
    expect(fileTypeFor("/ws/other.PlantUML")?.language).toBe("plantuml");
    expect(fileTypeFor("/ws/notes.md")).toBeUndefined();
  });

  it("keeps the earliest registration for a shared extension", () => {
    register(["puml"], "first");
    register(["puml"], "second");
    expect(fileTypeFor("a.puml")?.language).toBe("first");
  });

  it.each([
    ["a newline in the language", { extensions: ["puml"], language: "x\n```\n[a](b)" }],
    ["a backtick in the language", { extensions: ["puml"], language: "x`y" }],
    // The renderer lookup reads the language as `language-([\w-]+)`.
    ["a dot in the language", { extensions: ["puml"], language: "x.y" }],
    ["a plus in the language", { extensions: ["puml"], language: "c++" }],
    ["no extensions", { extensions: [], language: "plantuml" }],
    ["a non-array extensions field", { extensions: "puml", language: "plantuml" }],
    ["an extension with a path in it", { extensions: ["a/b"], language: "plantuml" }],
    ["a markdown extension", { extensions: ["md"], language: "plantuml" }],
    ["a canvas extension", { extensions: ["Canvas"], language: "plantuml" }],
    ["a notebook extension", { extensions: ["ipynb"], language: "plantuml" }],
    ["an image extension", { extensions: ["png"], language: "plantuml" }],
  ])("refuses %s", (_, contribution) => {
    expect(() =>
      registerFileType(contribution as unknown as Parameters<typeof registerFileType>[0]),
    ).toThrow();
    expect(fileTypes.list()).toHaveLength(0);
  });

  it("lets a plugin claim .d2, which the app only associates", () => {
    register(["d2"], "d2");
    expect(fileTypeFor("a.d2")?.language).toBe("d2");
  });

  it("forgets a file type once its disposer runs", () => {
    register(["puml"], "plantuml");
    for (const dispose of disposers.splice(0)) dispose();
    expect(fileTypeFor("a.puml")).toBeUndefined();
    expect(fileTypes.list()).toHaveLength(0);
  });
});
