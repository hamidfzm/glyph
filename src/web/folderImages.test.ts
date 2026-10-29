import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pickedFile } from "@/test/pickedFile";
import { pickFolderImages } from "./folderImages";

let created: File[] = [];

beforeEach(() => {
  created = [];
  vi.spyOn(URL, "createObjectURL").mockImplementation((file) => {
    created.push(file as File);
    return `blob:picked/${created.length}`;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("pickFolderImages", () => {
  it("finds an image by its path inside the picked folder", () => {
    const shot = pickedFile("docs/shot.png");
    const nested = pickedFile("docs/assets/my shot.png");
    const folder = pickFolderImages([shot, nested]);
    expect(folder.url("shot.png")).toBe("blob:picked/1");
    expect(folder.url("./assets/my%20shot.png")).toBe("blob:picked/2");
    expect(created).toEqual([shot, nested]);
  });

  it("reads a Windows separator, a query and a fragment as a browser would", () => {
    const folder = pickFolderImages([pickedFile("docs/assets/shot.png")]);
    expect(folder.url("assets\\shot.png")).not.toBeNull();
    expect(folder.url("assets/shot.png?raw=true")).not.toBeNull();
    expect(folder.url("assets/shot.png#top")).not.toBeNull();
  });

  it("does not match the picked folder's own name", () => {
    const folder = pickFolderImages([pickedFile("docs/shot.png")]);
    expect(folder.url("docs/shot.png")).toBeNull();
  });

  it("finds nothing for an image the folder lacks", () => {
    const folder = pickFolderImages([pickedFile("docs/shot.png")]);
    expect(folder.url("missing.png")).toBeNull();
    expect(folder.url("Shot.png")).toBeNull();
    expect(created).toEqual([]);
  });

  it("maps only image files", () => {
    const folder = pickFolderImages([pickedFile("docs/notes.md"), pickedFile("docs/run.sh")]);
    expect(folder.url("notes.md")).toBeNull();
    expect(folder.url("run.sh")).toBeNull();
  });

  it("never leaves the folder, even when a file of that name is in it", () => {
    const folder = pickFolderImages([
      pickedFile("docs/shot.png"),
      pickedFile("docs/docs/shot.png"),
    ]);
    for (const src of [
      "../docs/shot.png",
      "%2E%2E/docs/shot.png",
      "sub/%2e%2e/shot.png",
      "/shot.png",
      "/docs/shot.png",
    ]) {
      expect(folder.url(src)).toBeNull();
    }
  });

  it("hands out one URL per image however often it is named", () => {
    const folder = pickFolderImages([pickedFile("docs/shot.png")]);
    expect(folder.url("shot.png")).toBe(folder.url("./shot.png"));
    expect(created).toHaveLength(1);
  });

  it("revokes every URL it handed out, and finds nothing after", () => {
    const folder = pickFolderImages([pickedFile("docs/a.png"), pickedFile("docs/b.svg")]);
    const urls = [folder.url("a.png"), folder.url("b.svg")];
    folder.revoke();
    expect(vi.mocked(URL.revokeObjectURL).mock.calls.map(([url]) => url)).toEqual(urls);
    expect(folder.url("a.png")).toBeNull();
    expect(created).toHaveLength(2);
  });
});
