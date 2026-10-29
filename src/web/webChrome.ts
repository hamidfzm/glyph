import { PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from "@/components/layout/emptyStateStyles";
import { MARKDOWN_EXTENSIONS } from "@/lib/extensionConfig";
import { i18n } from "@/lib/i18n";

const TOOLBAR_BUTTON_CLASS = `${SECONDARY_BUTTON_CLASS} disabled:opacity-50 disabled:pointer-events-none`;

export interface WebChrome {
  emptyState: HTMLElement;
  fileInput: HTMLInputElement;
  copyButton: HTMLButtonElement;
  imagesButton: HTMLButtonElement;
  folderInput: HTMLInputElement;
  status: HTMLElement;
}

/** The toolbar above the document and the empty state shown in its place, inserted before `root`. */
export function createWebChrome(root: HTMLElement): WebChrome {
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.hidden = true;
  fileInput.accept = MARKDOWN_EXTENSIONS.map((extension) => `.${extension}`).join(",");

  const openButton = button(i18n.t("emptyState.openFile"), TOOLBAR_BUTTON_CLASS);
  const copyButton = button(i18n.t("preview.copyLink"), TOOLBAR_BUTTON_CLASS);
  copyButton.disabled = true;
  const imagesButton = button(i18n.t("preview.chooseImageFolder"), TOOLBAR_BUTTON_CLASS);
  imagesButton.title = i18n.t("preview.chooseImageFolderHint");
  imagesButton.hidden = true;
  // A folder input rather than the File System Access API, which Safari and Firefox lack.
  const folderInput = document.createElement("input");
  folderInput.type = "file";
  folderInput.hidden = true;
  folderInput.webkitdirectory = true;
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const header = document.createElement("header");
  header.append(openButton, copyButton, imagesButton, status, fileInput, folderInput);

  const heading = document.createElement("h1");
  heading.textContent = i18n.t("emptyState.openHeading");
  const hint = document.createElement("p");
  hint.textContent = i18n.t("preview.dropHint");
  const emptyOpenButton = button(i18n.t("emptyState.openFile"), PRIMARY_BUTTON_CLASS);
  // A second <main>: the viewer shows either it or `root`, never both.
  const emptyState = document.createElement("main");
  emptyState.append(heading, hint, emptyOpenButton);

  for (const opener of [openButton, emptyOpenButton]) {
    opener.addEventListener("click", () => fileInput.click());
  }
  // html and body do not scroll, so the keyboard reaches the document only
  // through a focusable scroller.
  root.tabIndex = 0;
  root.hidden = true;
  root.before(header, emptyState);
  return { emptyState, fileInput, copyButton, imagesButton, folderInput, status };
}

function button(label: string, className: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = label;
  return element;
}
