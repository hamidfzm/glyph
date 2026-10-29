import { afterEach, describe, expect, it, vi } from "vitest";
import type { Disposer } from "./disposer";
import {
  fileTypeFor,
  fileTypes,
  readWithSettledFileTypes,
  registeredExtensions,
  registerFileType,
} from "./fileTypes";

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

  it("lists each registered extension once", () => {
    expect(registeredExtensions()).toEqual([]);
    register(["puml", "plantuml"], "plantuml");
    register(["puml", "wsd"], "other");
    expect(registeredExtensions()).toEqual(["puml", "plantuml", "wsd"]);
  });
});

describe("readWithSettledFileTypes", () => {
  it("reads once while the file types stay put", async () => {
    const read = vi.fn(async () => registeredExtensions());
    await expect(readWithSettledFileTypes(read)).resolves.toEqual([]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("reads again when a file type registers or goes away mid-read", async () => {
    let changes = [
      () => register(["puml"], "plantuml"),
      () => {
        for (const dispose of disposers.splice(0)) dispose();
      },
    ];
    const read = vi.fn(async () => {
      const seen = registeredExtensions();
      changes.shift()?.();
      return seen;
    });

    await expect(readWithSettledFileTypes(read)).resolves.toEqual([]);
    expect(read).toHaveBeenCalledTimes(3);

    changes = [() => register(["wsd"], "other")];
    await expect(readWithSettledFileTypes(read)).resolves.toEqual(["wsd"]);
    expect(read).toHaveBeenCalledTimes(5);
  });
});
