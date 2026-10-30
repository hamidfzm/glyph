import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pickedFile } from "@/test/pickedFile";
import { pickFolderImages } from "./folderImages";

// By path: two files of one name compare equal.
let created: string[] = [];

beforeEach(() => {
  created = [];
  vi.spyOn(URL, "createObjectURL").mockImplementation((file) => {
    created.push((file as File).webkitRelativePath);
    return `blob:picked/${created.length}`;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("pickFolderImages", () => {
  it("finds an image by its path inside the picked folder", () => {
    const folder = pickFolderImages(
      [pickedFile("docs/shot.png"), pickedFile("docs/assets/my shot.png")],
      null,
    );
    expect(folder.url("shot.png")).toBe("blob:picked/1");
    expect(folder.url("./assets/my%20shot.png")).toBe("blob:picked/2");
    expect(created).toEqual(["docs/shot.png", "docs/assets/my shot.png"]);
  });

  it("reads a Windows separator, a query and a fragment as a browser would", () => {
    const folder = pickFolderImages([pickedFile("docs/assets/shot.png")], null);
    expect(folder.url("assets\\shot.png")).not.toBeNull();
    expect(folder.url("assets/shot.png?raw=true")).not.toBeNull();
    expect(folder.url("assets/shot.png#top")).not.toBeNull();
  });

  it("does not match the picked folder's own name", () => {
    const folder = pickFolderImages([pickedFile("docs/shot.png")], null);
    expect(folder.url("docs/shot.png")).toBeNull();
  });

  it("finds nothing for an image the folder lacks", () => {
    const folder = pickFolderImages([pickedFile("docs/shot.png")], null);
    expect(folder.url("missing.png")).toBeNull();
    expect(folder.url("Shot.png")).toBeNull();
    expect(created).toEqual([]);
  });

  it("maps only image files", () => {
    const folder = pickFolderImages([pickedFile("docs/notes.md"), pickedFile("docs/run.sh")], null);
    expect(folder.url("notes.md")).toBeNull();
    expect(folder.url("run.sh")).toBeNull();
  });

  it("never leaves the folder, even when a file of that name is in it", () => {
    const folder = pickFolderImages(
      [pickedFile("docs/shot.png"), pickedFile("docs/docs/shot.png")],
      null,
    );
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

  it("resolves images from where the opened document sits in the folder", () => {
    const opened = pickedFile("anywhere/README.md", "# Doc");
    const folder = pickFolderImages(
      [
        pickedFile("repo/shot.png"),
        pickedFile("repo/docs/guide/README.md", "# Doc"),
        pickedFile("repo/docs/guide/shot.png"),
        pickedFile("repo/docs/guide/assets/nested.png"),
      ],
      opened,
    );
    folder.url("shot.png");
    folder.url("./assets/nested.png");
    expect(created).toEqual(["repo/docs/guide/shot.png", "repo/docs/guide/assets/nested.png"]);
  });

  it("never reaches above the document, even inside the picked folder", () => {
    const folder = pickFolderImages(
      [pickedFile("repo/shot.png"), pickedFile("repo/docs/README.md", "# Doc")],
      pickedFile("anywhere/README.md", "# Doc"),
    );
    for (const src of [
      "../shot.png",
      "%2E%2E/shot.png",
      "sub/%2e%2e/%2e%2e/shot.png",
      "/shot.png",
    ]) {
      expect(folder.url(src)).toBeNull();
    }
  });

  it("resolves from the top of the folder when it does not hold the document", () => {
    const opened = pickedFile("anywhere/README.md", "# Mine", 2);
    for (const other of [
      pickedFile("repo/docs/README.md", "# Longer text", 2),
      pickedFile("repo/docs/README.md", "# Mine", 3),
      pickedFile("repo/docs/NOTES.md", "# Mine", 2),
    ]) {
      const folder = pickFolderImages(
        [pickedFile("repo/shot.png"), other, pickedFile("repo/docs/shot.png")],
        opened,
      );
      created = [];
      folder.url("shot.png");
      expect(created).toEqual(["repo/shot.png"]);
    }
  });

  it("takes the copy nearest the top when the document is in the folder twice", () => {
    const folder = pickFolderImages(
      [
        pickedFile("repo/near/deep/README.md", "# Doc"),
        pickedFile("repo/near/README.md", "# Doc"),
        pickedFile("repo/near/deep/shot.png"),
        pickedFile("repo/near/shot.png"),
      ],
      pickedFile("anywhere/README.md", "# Doc"),
    );
    folder.url("shot.png");
    expect(created).toEqual(["repo/near/shot.png"]);
  });

  it("hands out one URL per image however often it is named", () => {
    const folder = pickFolderImages([pickedFile("docs/shot.png")], null);
    expect(folder.url("shot.png")).toBe(folder.url("./shot.png"));
    expect(created).toHaveLength(1);
  });

  it("revokes every URL it handed out, and finds nothing after", () => {
    const folder = pickFolderImages([pickedFile("docs/a.png"), pickedFile("docs/b.svg")], null);
    const urls = [folder.url("a.png"), folder.url("b.svg")];
    folder.revoke();
    expect(vi.mocked(URL.revokeObjectURL).mock.calls.map(([url]) => url)).toEqual(urls);
    expect(folder.url("a.png")).toBeNull();
    expect(created).toHaveLength(2);
  });
});
