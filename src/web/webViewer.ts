import { i18n } from "@/lib/i18n";
import { decodeDocument, encodeDocument, MAX_LINK_LENGTH } from "@/lib/linkCodec";
import { type PreviewMessage, startPreview } from "@/preview/startPreview";
import { readDocumentFile } from "./documentText";
import { type FolderImages, pickFolderImages } from "./folderImages";
import { handleDocumentClick } from "./linkClicks";
import { createWebChrome } from "./webChrome";

export interface WebViewerOptions {
  root: HTMLElement;
  darkQuery: MediaQueryList;
  language: string;
}

/** A document on screen whose relative images became alt text: `dropped` of them with no folder picked. */
interface ImageOffer {
  message: PreviewMessage;
  dropped: number;
}

/** The preview page in a browser: documents come from a picked or dropped file, or from the URL fragment. */
export async function startWebViewer({ root, darkQuery, language }: WebViewerOptions) {
  const preview = startPreview({ root, darkQuery, language });
  await preview.ready;
  const chrome = createWebChrome(root);
  // One counter for every source, so whichever request started last wins (INV-3).
  let latestRequest = 0;
  let link: string | null = null;
  // Only a fragment not already handled loads anything, so a repeated
  // hashchange cannot replace a file opened since.
  let handledFragment: string | null = null;
  let imageOffer: ImageOffer | null = null;
  // The offer the folder picker was opened for, so a pick that lands after the
  // document changed is dropped (INV-3).
  let pickingFor: ImageOffer | null = null;
  let folder: FolderImages | null = null;

  function present(message: PreviewMessage | null) {
    folder?.revoke();
    folder = null;
    const emptyStateHadFocus = chrome.emptyState.contains(document.activeElement);
    const shown = preview.show(message);
    chrome.emptyState.hidden = message !== null;
    root.hidden = message === null;
    // Hiding the focused Open File button would drop focus to the body.
    if (emptyStateHadFocus && message) root.focus({ preventScroll: true });
    return shown;
  }

  async function load(request: () => Promise<PreviewMessage | null>) {
    const id = ++latestRequest;
    link = null;
    imageOffer = null;
    chrome.copyButton.disabled = true;
    // Hiding the focused button would drop focus to the body.
    if (document.activeElement === chrome.imagesButton) root.focus({ preventScroll: true });
    chrome.imagesButton.hidden = true;
    chrome.status.textContent = "";
    const message = await request();
    if (id !== latestRequest) return;
    const shown = present(message);
    if (message?.kind !== "document") return;
    void offerFolder(id, message, shown);
    // Encoded now so a click can copy synchronously: Safari refuses a clipboard
    // write that follows an await. A browser without deflate-raw keeps the
    // button disabled.
    const fragment = await encodeDocument(message.content).catch(() => null);
    if (id !== latestRequest || fragment === null) return;
    link = `${location.origin}${location.pathname}${location.search}#${fragment}`;
    chrome.copyButton.disabled = false;
  }

  async function offerFolder(id: number, message: PreviewMessage, shown: Promise<number | null>) {
    const dropped = await shown;
    if (!dropped || id !== latestRequest) return;
    imageOffer = { message, dropped };
    chrome.imagesButton.hidden = false;
  }

  async function showFolderImages(files: File[]) {
    const offer = pickingFor;
    if (!offer || offer !== imageOffer) return;
    folder?.revoke();
    folder = pickFolderImages(files);
    chrome.status.textContent = "";
    const dropped = await preview.show(offer.message, folder.url);
    // A later pick or another document replaced this one.
    if (dropped === null || offer !== imageOffer) return;
    const noneFound = dropped === offer.dropped;
    if (noneFound) chrome.status.textContent = i18n.t("preview.noFolderImages");
  }

  function showFragment() {
    const fragment = location.hash.slice(1);
    if (fragment === handledFragment) return;
    handledFragment = fragment;
    void load(async () => {
      if (!fragment) return null;
      const content = await decodeDocument(fragment);
      if (content === null) return { kind: "invalidLink" };
      return { kind: "document", content, baseUrl: null };
    });
  }

  function showFile(file: File) {
    // Leave the shared link behind in history, so Back returns to it.
    if (location.hash) history.pushState(null, "", `${location.pathname}${location.search}`);
    handledFragment = "";
    void load(() => readDocumentFile(file));
  }

  function copyLink() {
    if (!link) return;
    if (link.length > MAX_LINK_LENGTH) {
      chrome.status.textContent = i18n.t("preview.linkTooLong");
      return;
    }
    if (!navigator.clipboard) {
      chrome.status.textContent = i18n.t("preview.copyFailed");
      return;
    }
    // A copy that settles after another document opened reports nothing.
    const id = latestRequest;
    const report = (key: string) => {
      if (id === latestRequest) chrome.status.textContent = i18n.t(key);
    };
    navigator.clipboard.writeText(link).then(
      () => report("preview.linkCopied"),
      () => report("preview.copyFailed"),
    );
  }

  chrome.fileInput.addEventListener("change", () => {
    const file = chrome.fileInput.files?.[0];
    // Cleared so picking the same file again still fires a change.
    chrome.fileInput.value = "";
    if (file) showFile(file);
  });
  chrome.imagesButton.addEventListener("click", () => {
    pickingFor = imageOffer;
    chrome.folderInput.click();
  });
  chrome.folderInput.addEventListener("change", () => {
    const files = Array.from(chrome.folderInput.files ?? []);
    chrome.folderInput.value = "";
    void showFolderImages(files);
  });
  chrome.copyButton.addEventListener("click", copyLink);
  root.addEventListener("click", (event) => handleDocumentClick(event, root));
  window.addEventListener("dragover", (event) => {
    if (carriesFiles(event)) event.preventDefault();
  });
  window.addEventListener("drop", (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    const file = event.dataTransfer?.files[0];
    if (file) showFile(file);
  });
  // Back and Forward may report either event; a repeat is ignored.
  window.addEventListener("hashchange", showFragment);
  window.addEventListener("popstate", showFragment);
  // A shared link shows nothing while it decodes, not the empty state.
  chrome.emptyState.hidden = location.hash.length > 1;
  showFragment();
}

// A text or link drag keeps the browser's default; only files are opened.
function carriesFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes("Files") ?? false;
}
