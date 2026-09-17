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

  it("forgets a file type once its disposer runs", () => {
    register(["puml"], "plantuml");
    for (const dispose of disposers.splice(0)) dispose();
    expect(fileTypeFor("a.puml")).toBeUndefined();
    expect(fileTypes.list()).toHaveLength(0);
  });
});
