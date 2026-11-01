import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/lib/i18n";
import { decodeDocument, encodeDocument } from "@/lib/linkCodec";
import { deferred } from "@/test/deferred";
import { pickedFile } from "@/test/pickedFile";
import { startWebViewer } from "./webViewer";

vi.mock("@/preview/renderPreview", () => ({
  renderPreview: vi.fn((content: string) =>
    Promise.resolve({
      html: `<p>${content.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</p>`,
      droppedImages: 0,
    }),
  ),
}));

const { renderPreview } = await import("@/preview/renderPreview");
const actualRender =
  await vi.importActual<typeof import("@/preview/renderPreview")>("@/preview/renderPreview");

vi.mock("@/lib/linkCodec", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/linkCodec")>();
  return { ...original, encodeDocument: vi.fn(original.encodeDocument) };
});

type Listener = [string, EventListenerOrEventListenerObject];
let windowListeners: Listener[] = [];

function stubDarkQuery() {
  return {
    matches: false,
    addEventListener: () => {},
  } as unknown as MediaQueryList;
}

async function start(hash = "") {
  history.replaceState(null, "", `/view/${hash}`);
  const root = document.createElement("main");
  root.id = "preview";
  document.body.append(root);
  await startWebViewer({ root, darkQuery: stubDarkQuery(), language: "en" });
  const emptyState = document.querySelector<HTMLElement>("body > main:not(#preview)")!;
  const fileInput = document.querySelector<HTMLInputElement>("input[type=file]")!;
  const copyButton = screen.getByRole<HTMLButtonElement>("button", {
    name: i18n.t("preview.copyLink", { lng: "en" }),
  });
  // By text: a hidden button has no accessible name.
  const imagesButton = screen.getByText<HTMLButtonElement>(
    i18n.t("preview.showImages", { lng: "en" }),
  );
  const folderInput = document.querySelectorAll<HTMLInputElement>("input[type=file]")[1];
  const status = document.querySelector<HTMLElement>("[role=status]")!;
  return { root, emptyState, fileInput, copyButton, imagesButton, folderInput, status };
}

function pick(input: HTMLInputElement, ...files: File[]) {
  Object.defineProperty(input, "files", { value: files, configurable: true });
  input.dispatchEvent(new Event("change"));
}

function dragEvent(type: "dragover" | "drop", types: string[], files: File[] = []) {
  const event = new Event(type, { cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { types, files } });
  window.dispatchEvent(event);
  return event;
}

function navigateTo(hash: string) {
  history.replaceState(null, "", `/view/${hash}`);
  window.dispatchEvent(new Event("hashchange"));
}

// A file whose read resolves only when the test says so.
function slowFile(content: string, name = "slow.md") {
  const file = new File([content], name);
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const read = file.arrayBuffer.bind(file);
  vi.spyOn(file, "arrayBuffer").mockImplementation(async () => {
    await gate;
    return read();
  });
  return { file, release };
}

const t = (key: string) => i18n.t(key, { lng: "en" });

// Each test starts its own viewer on the shared window, so its listeners are
// recorded and removed afterwards to keep one test's viewer out of the next.
const addListener = window.addEventListener;

beforeEach(() => {
  windowListeners = [];
  vi.spyOn(window, "addEventListener").mockImplementation((type, listener, options) => {
    windowListeners.push([type, listener]);
    addListener.call(window, type, listener, options);
  });
});

afterEach(() => {
  for (const [type, listener] of windowListeners) window.removeEventListener(type, listener);
  document.body.replaceChildren();
  history.replaceState(null, "", "/");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("startWebViewer", () => {
  it("shows the empty state, translated, until a document opens", async () => {
    const { root, emptyState, copyButton } = await start();
    await vi.waitFor(() => expect(root.hidden).toBe(true));
    expect(emptyState.hidden).toBe(false);
    expect(emptyState.querySelector("h1")?.textContent).toBe(t("emptyState.openHeading"));
    expect(copyButton.textContent).toBe(t("preview.copyLink"));
    expect(copyButton.disabled).toBe(true);
  });

  it("opens the document a shared link carries", async () => {
    const { root, emptyState, copyButton } = await start(`#${await encodeDocument("# Shared")}`);
    await vi.waitFor(() => expect(root.textContent).toBe("# Shared"));
    expect(emptyState.hidden).toBe(true);
    await vi.waitFor(() => expect(copyButton.disabled).toBe(false));
  });

  it("shows a notice for a link it cannot decode", async () => {
    const { root } = await start("#v1.not-a-document");
    await vi.waitFor(() => expect(root.textContent).toBe(t("preview.invalidLink")));
  });

  it("follows the fragment as it changes, back to the empty state", async () => {
    const { root, emptyState } = await start(`#${await encodeDocument("# One")}`);
    await vi.waitFor(() => expect(root.textContent).toBe("# One"));
    navigateTo(`#${await encodeDocument("# Two")}`);
    await vi.waitFor(() => expect(root.textContent).toBe("# Two"));
    navigateTo("");
    await vi.waitFor(() => expect(emptyState.hidden).toBe(false));
    expect(root.hidden).toBe(true);
  });

  it("opens a picked file and clears the picker so the same file can be picked again", async () => {
    const { root, fileInput } = await start();
    const click = vi.spyOn(fileInput, "click").mockImplementation(() => {});
    document.querySelector<HTMLButtonElement>("main:not(#preview) button")?.click();
    expect(click).toHaveBeenCalledTimes(1);

    pick(fileInput, new File(["# Picked"], "picked.md"));
    expect(fileInput.value).toBe("");
    await vi.waitFor(() => expect(root.textContent).toBe("# Picked"));
  });

  it("hands keyboard focus to the document that replaces the empty state", async () => {
    const { root, emptyState, fileInput } = await start();
    await vi.waitFor(() => expect(root.hidden).toBe(true));
    emptyState.querySelector("button")?.focus();
    pick(fileInput, new File(["# Focused"], "focused.md"));
    await vi.waitFor(() => expect(root.textContent).toBe("# Focused"));
    expect(document.activeElement).toBe(root);
    expect(root.tabIndex).toBe(0);
  });

  it("does nothing when the picker reports a change with no file", async () => {
    const { root, fileInput } = await start(`#${await encodeDocument("# Kept")}`);
    await vi.waitFor(() => expect(root.textContent).toBe("# Kept"));
    const push = vi.spyOn(history, "pushState");
    Object.defineProperty(fileInput, "files", { value: [], configurable: true });
    fileInput.dispatchEvent(new Event("change"));
    expect(push).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(root.textContent).toBe("# Kept");
  });

  it("leaves a drag with no data to the browser", async () => {
    await start();
    const event = new Event("dragover", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("offers only markdown files in the picker", async () => {
    const { fileInput } = await start();
    expect(fileInput.accept.split(",")).toContain(".md");
    expect(fileInput.accept.split(",").every((extension) => extension.startsWith("."))).toBe(true);
  });

  it("opens the first of the files dropped on the page", async () => {
    const { root } = await start();
    expect(dragEvent("dragover", ["Files"]).defaultPrevented).toBe(true);
    const drop = dragEvent(
      "drop",
      ["Files"],
      [new File(["# First"], "a.md"), new File(["# Second"], "b.md")],
    );
    expect(drop.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(root.textContent).toBe("# First"));
  });

  it("leaves a text or link drag to the browser", async () => {
    const { root } = await start();
    expect(dragEvent("dragover", ["text/plain"]).defaultPrevented).toBe(false);
    expect(dragEvent("drop", ["text/plain"]).defaultPrevented).toBe(false);
    await Promise.resolve();
    expect(root.textContent).toBe("");
  });

  it("leaves a shared link in history when a file opens over it", async () => {
    const { root, fileInput } = await start(`#${await encodeDocument("# Shared")}`);
    await vi.waitFor(() => expect(root.textContent).toBe("# Shared"));
    const push = vi.spyOn(history, "pushState");
    pick(fileInput, new File(["# Local"], "local.md"));
    expect(push).toHaveBeenCalledWith(null, "", "/view/");
    await vi.waitFor(() => expect(root.textContent).toBe("# Local"));
  });

  it("ignores a repeated hashchange, keeping a file opened since", async () => {
    const { root, fileInput } = await start();
    pick(fileInput, new File(["# Kept"], "kept.md"));
    await vi.waitFor(() => expect(root.textContent).toBe("# Kept"));
    window.dispatchEvent(new Event("hashchange"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(root.textContent).toBe("# Kept");
  });

  it("shows only the later file when an earlier read finishes last", async () => {
    const { root, fileInput } = await start();
    const slow = slowFile("# Slow");
    pick(fileInput, slow.file);
    pick(fileInput, new File(["# Fast"], "fast.md"));
    await vi.waitFor(() => expect(root.textContent).toBe("# Fast"));
    slow.release();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(root.textContent).toBe("# Fast");
  });

  it("lets a link opened later win over a file still being read", async () => {
    const { root, fileInput } = await start();
    const slow = slowFile("# Slow");
    pick(fileInput, slow.file);
    navigateTo(`#${await encodeDocument("# Link")}`);
    await vi.waitFor(() => expect(root.textContent).toBe("# Link"));
    slow.release();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(root.textContent).toBe("# Link");
  });

  it("copies a link that opens the same document, and says so", async () => {
    const writeText = vi.fn((_text: string) => Promise.resolve());
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const { root, fileInput, copyButton, status } = await start();
    pick(fileInput, new File(["# Copy me ✓"], "copy.md"));
    await vi.waitFor(() => expect(copyButton.disabled).toBe(false));
    expect(root.textContent).toBe("# Copy me ✓");

    copyButton.click();
    await vi.waitFor(() => expect(status.textContent).toBe(t("preview.linkCopied")));
    const url = new URL(writeText.mock.calls[0][0]);
    expect(url.pathname).toBe("/view/");
    expect(await decodeDocument(url.hash.slice(1))).toBe("# Copy me ✓");
  });

  it("keeps Copy link disabled until the link is ready", async () => {
    let finish: (fragment: string) => void = () => {};
    vi.mocked(encodeDocument).mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    );
    const writeText = vi.fn((_text: string) => Promise.resolve());
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const { root, fileInput, copyButton, status } = await start();
    pick(fileInput, new File(["# Pending"], "pending.md"));
    await vi.waitFor(() => expect(root.textContent).toBe("# Pending"));
    expect(copyButton.disabled).toBe(true);
    // A click that still reaches the disabled button, say from a script, copies nothing.
    copyButton.dispatchEvent(new Event("click"));
    expect(writeText).not.toHaveBeenCalled();
    expect(status.textContent).toBe("");
    finish("v1.AAAA");
    await vi.waitFor(() => expect(copyButton.disabled).toBe(false));
  });

  it("copies the link of the document on screen when an earlier encode finishes last", async () => {
    let finishFirst: (fragment: string) => void = () => {};
    vi.mocked(encodeDocument).mockImplementationOnce(
      () => new Promise((resolve) => (finishFirst = resolve)),
    );
    const writeText = vi.fn((_text: string) => Promise.resolve());
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const { root, fileInput, copyButton } = await start();
    pick(fileInput, new File(["# First"], "first.md"));
    await vi.waitFor(() => expect(root.textContent).toBe("# First"));
    pick(fileInput, new File(["# Second"], "second.md"));
    await vi.waitFor(() => expect(copyButton.disabled).toBe(false));

    finishFirst("v1.STALE");
    await new Promise((resolve) => setTimeout(resolve, 10));
    copyButton.click();
    const url = new URL(writeText.mock.calls[0][0]);
    expect(await decodeDocument(url.hash.slice(1))).toBe("# Second");
  });

  it("drops a copy result that settles after another document opened", async () => {
    let settleCopy: () => void = () => {};
    const writeText = vi.fn(() => new Promise<void>((resolve) => (settleCopy = resolve)));
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const { root, fileInput, copyButton, status } = await start();
    pick(fileInput, new File(["# Copied"], "copied.md"));
    await vi.waitFor(() => expect(copyButton.disabled).toBe(false));
    copyButton.click();

    pick(fileInput, new File(["# Next"], "next.md"));
    await vi.waitFor(() => expect(root.textContent).toBe("# Next"));
    settleCopy();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(status.textContent).toBe("");
  });

  it("keeps Copy link disabled when the browser cannot compress", async () => {
    vi.mocked(encodeDocument).mockRejectedValueOnce(new TypeError("deflate-raw unsupported"));
    const { root, fileInput, copyButton } = await start();
    pick(fileInput, new File(["# Old browser"], "old.md"));
    await vi.waitFor(() => expect(root.textContent).toBe("# Old browser"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(copyButton.disabled).toBe(true);
  });

  it("shows neither the empty state nor a document while a shared link decodes", async () => {
    const { root, emptyState } = await start(`#${await encodeDocument("# Pending")}`);
    expect(emptyState.hidden).toBe(true);
    expect(root.hidden).toBe(true);
    await vi.waitFor(() => expect(root.textContent).toBe("# Pending"));
  });

  it("says when copying fails or the clipboard is unavailable", async () => {
    const { fileInput, copyButton, status } = await start();
    pick(fileInput, new File(["# Doc"], "doc.md"));
    await vi.waitFor(() => expect(copyButton.disabled).toBe(false));

    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: () => Promise.reject() } });
    copyButton.click();
    await vi.waitFor(() => expect(status.textContent).toBe(t("preview.copyFailed")));

    status.textContent = "";
    vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });
    copyButton.click();
    expect(status.textContent).toBe(t("preview.copyFailed"));
  });

  it("refuses to copy a link too long for a browser to open", async () => {
    const writeText = vi.fn((_text: string) => Promise.resolve());
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    // Random printable text barely compresses, so its link outgrows the URL limit.
    const noise = Array.from({ length: 2_000_000 }, () =>
      String.fromCharCode(32 + Math.floor(Math.random() * 95)),
    ).join("");
    const { fileInput, copyButton, status } = await start();
    pick(fileInput, new File([noise], "noise.md"));
    await vi.waitFor(() => expect(copyButton.disabled).toBe(false), { timeout: 10_000 });

    copyButton.click();
    expect(status.textContent).toBe(t("preview.linkTooLong"));
    expect(writeText).not.toHaveBeenCalled();
  });

  it("writes nothing to the browser's storage", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const { root, fileInput } = await start(`#${await encodeDocument("# Stored?")}`);
    await vi.waitFor(() => expect(root.textContent).toBe("# Stored?"));
    pick(fileInput, new File(["# Still not"], "file.md"));
    await vi.waitFor(() => expect(root.textContent).toBe("# Still not"));
    expect(setItem).not.toHaveBeenCalled();
    expect(document.cookie).toBe("");
  });
});

describe("images from a picked folder", () => {
  // By path: two files of one name compare equal.
  let created: string[] = [];

  async function link(markdown: string) {
    return `#${await encodeDocument(markdown)}`;
  }

  // Opens a document whose relative images need a folder, and opens the picker for it.
  async function startOffering(markdown: string) {
    const viewer = await start(await link(markdown));
    await vi.waitFor(() => expect(viewer.imagesButton.hidden).toBe(false));
    vi.spyOn(viewer.folderInput, "click").mockImplementation(() => {});
    viewer.imagesButton.click();
    return viewer;
  }

  beforeEach(() => {
    created = [];
    // The real pipeline, so the plugin decides which images a folder could hold.
    vi.mocked(renderPreview).mockImplementation(actualRender.renderPreview);
    vi.spyOn(URL, "createObjectURL").mockImplementation((file) => {
      created.push((file as File).webkitRelativePath);
      return `blob:picked/${created.length}`;
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.mocked(renderPreview).mockReset();
  });

  it("offers a folder only for a document with relative images", async () => {
    const { root, fileInput, imagesButton, status } = await start(await link("![shot](shot.png)"));
    await vi.waitFor(() => expect(imagesButton.hidden).toBe(false));
    expect(status.textContent).toBe(t("preview.imagesNeedFolder"));

    for (const markdown of ["# No images", "![far](https://example.com/far.png) No images"]) {
      pick(fileInput, new File([markdown], "other.md"));
      await vi.waitFor(() => expect(root.textContent).toContain("No images"));
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(imagesButton.hidden).toBe(true);
      expect(status.textContent).toBe("");
    }
  });

  it("resolves images from where the opened file sits in the picked folder", async () => {
    const markdown = "![shot](shot.png)";
    const { root, fileInput, folderInput, imagesButton } = await start();
    vi.spyOn(folderInput, "click").mockImplementation(() => {});
    pick(fileInput, new File([markdown], "doc.md", { lastModified: 1 }));
    await vi.waitFor(() => expect(imagesButton.hidden).toBe(false));
    imagesButton.click();

    pick(
      folderInput,
      pickedFile("repo/shot.png"),
      pickedFile("repo/docs/doc.md", markdown),
      pickedFile("repo/docs/shot.png"),
    );
    await vi.waitFor(() => expect(root.querySelector("img")).not.toBeNull());
    expect(created).toEqual(["repo/docs/shot.png"]);
  });

  it("shows each image the picked folder holds and leaves the rest as alt text", async () => {
    const { root, folderInput, imagesButton, status } = await startOffering(
      "![shot](shot.png) ![nested](assets/nested.png) ![gone](gone.png)",
    );
    expect(folderInput.click).toHaveBeenCalledTimes(1);
    expect(folderInput.webkitdirectory).toBe(true);
    pick(
      folderInput,
      pickedFile("docs/shot.png"),
      pickedFile("docs/assets/nested.png"),
      pickedFile("docs/notes.md"),
    );
    expect(folderInput.value).toBe("");

    await vi.waitFor(() => expect(root.querySelectorAll("img")).toHaveLength(2));
    const sources = Array.from(root.querySelectorAll("img"), (image) => image.getAttribute("src"));
    expect(sources).toEqual(["blob:picked/1", "blob:picked/2"]);
    expect(created).toEqual(["docs/shot.png", "docs/assets/nested.png"]);
    expect(root.textContent).toContain("gone");
    expect(status.textContent).toBe("");
    // Another folder may hold the rest.
    expect(imagesButton.hidden).toBe(false);
  });

  it("ignores a folder the button did not ask for", async () => {
    const { root, folderInput, imagesButton } = await start(await link("![shot](shot.png)"));
    await vi.waitFor(() => expect(imagesButton.hidden).toBe(false));
    pick(folderInput, pickedFile("docs/shot.png"));
    Object.defineProperty(folderInput, "files", { value: null, configurable: true });
    folderInput.dispatchEvent(new Event("change"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(root.querySelector("img")).toBeNull();
  });

  it("hands focus to the document when the next one hides the focused button", async () => {
    const { root, folderInput, imagesButton } = await startOffering("![shot](shot.png)");
    pick(folderInput, pickedFile("docs/shot.png"));
    imagesButton.focus();
    navigateTo(await link("# Next"));
    expect(imagesButton.hidden).toBe(true);
    expect(document.activeElement).toBe(root);
  });

  it("says so when the picked folder holds none of the document's images", async () => {
    const { root, folderInput, status } = await startOffering("![shot](shot.png)");
    pick(folderInput, pickedFile("docs/other.png"));
    await vi.waitFor(() => expect(status.textContent).toBe(t("preview.noFolderImages")));
    expect(root.querySelector("img")).toBeNull();
  });

  it("revokes the picked images when another document or the empty state opens", async () => {
    const { root, emptyState, folderInput, imagesButton } = await startOffering("![a](a.png)");
    pick(folderInput, pickedFile("docs/a.png"));
    await vi.waitFor(() => expect(root.querySelector("img")).not.toBeNull());

    navigateTo(await link("![b](b.png) Second"));
    await vi.waitFor(() => expect(root.textContent).toContain("Second"));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:picked/1");

    await vi.waitFor(() => expect(imagesButton.hidden).toBe(false));
    imagesButton.click();
    pick(folderInput, pickedFile("docs/b.png"));
    await vi.waitFor(() =>
      expect(root.querySelector("img")?.getAttribute("src")).toBe("blob:picked/2"),
    );
    navigateTo("");
    await vi.waitFor(() => expect(emptyState.hidden).toBe(false));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:picked/2");
    expect(imagesButton.hidden).toBe(true);
  });

  it("drops a folder picked for a document that has since changed", async () => {
    const { root, folderInput, imagesButton, status } = await startOffering("![shot](shot.png)");
    navigateTo(await link("![shot](shot.png) Newer"));
    await vi.waitFor(() => expect(root.textContent).toContain("Newer"));
    await vi.waitFor(() => expect(imagesButton.hidden).toBe(false));

    pick(folderInput, pickedFile("docs/shot.png"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(root.querySelector("img")).toBeNull();
    expect(status.textContent).toBe(t("preview.imagesNeedFolder"));
  });

  it("lets a document opened during a pick's render win, leaking no URL", async () => {
    const { root, folderInput, status } = await startOffering("![shot](shot.png)");
    const gate = deferred();
    vi.mocked(renderPreview).mockImplementationOnce(async (...args) => {
      await gate.promise;
      return actualRender.renderPreview(...args);
    });
    pick(folderInput, pickedFile("docs/shot.png"));
    await vi.waitFor(() => expect(renderPreview).toHaveBeenCalledTimes(2));

    navigateTo(await link("# Newer"));
    await vi.waitFor(() => expect(root.textContent).toBe("Newer"));
    gate.resolve();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(root.textContent).toBe("Newer");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(status.textContent).toBe("");
  });

  it("lets a later pick replace one still rendering", async () => {
    const { root, folderInput } = await startOffering("![shot](shot.png)");
    pick(folderInput, pickedFile("earlier/shot.png"));
    pick(folderInput, pickedFile("later/shot.png"));
    await vi.waitFor(() => expect(root.querySelector("img")).not.toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(created).toEqual(["later/shot.png"]);
    expect(root.querySelector("img")?.getAttribute("src")).toBe("blob:picked/1");
  });
});
