import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExportNoticeContent } from "@/hooks/useExportNotice";
import { i18n } from "@/lib/i18n";
import { ExportNotice } from "./ExportNotice";

const cleanupFailed = { kind: "pruneFailed", reason: "Access is denied. (os error 5)" } as const;
const copyFailed = {
  kind: "assetsFailed",
  reason: '"guide/shot.png": os error 2',
  more: 0,
} as const;

const defaultProps = {
  notice: { kind: "siteWarnings", warnings: [cleanupFailed] } as ExportNoticeContent,
  onDismiss: vi.fn(),
};

describe("ExportNotice", () => {
  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("says the site exported and why its cleanup did not finish", () => {
    render(<ExportNotice {...defaultProps} />);
    const notice = screen.getByRole("alert");
    expect(notice).toHaveTextContent(
      "The website was exported, but the cleanup after it did not finish.",
    );
    expect(notice).toHaveTextContent("Access is denied. (os error 5)");
  });

  it("says which files the pages use were not copied, and what that does to the pages", () => {
    render(
      <ExportNotice {...defaultProps} notice={{ kind: "siteWarnings", warnings: [copyFailed] }} />,
    );
    const notice = screen.getByRole("alert");
    expect(notice).toHaveTextContent(
      "The website was exported, but some files its pages use could not be copied. Those pages may show a missing or outdated image, media file or download.",
    );
    expect(notice).toHaveTextContent('"guide/shot.png": os error 2');
    expect(notice).not.toHaveTextContent("the cleanup after it did not finish");
    expect(notice).not.toHaveTextContent("could not be copied either");
  });

  it.each([
    [1, "1 more file could not be copied either."],
    [3, "3 more files could not be copied either."],
  ])("counts the copies that failed beside the one it names (%i more)", (more, text) => {
    const warnings = [{ ...copyFailed, more }];
    render(<ExportNotice {...defaultProps} notice={{ kind: "siteWarnings", warnings }} />);
    expect(screen.getByRole("alert")).toHaveTextContent(text);
  });

  it("translates the count of further failed copies with the rest of the notice", async () => {
    const warnings = [{ ...copyFailed, more: 2 }];
    render(<ExportNotice {...defaultProps} notice={{ kind: "siteWarnings", warnings }} />);
    await act(async () => {
      await i18n.changeLanguage("de");
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "2 weitere Dateien konnten ebenfalls nicht kopiert werden.",
    );
  });

  it("stacks a failed copy and a failed cleanup in one notice, each with its reason", () => {
    render(
      <ExportNotice
        {...defaultProps}
        notice={{ kind: "siteWarnings", warnings: [copyFailed, cleanupFailed] }}
      />,
    );
    const copy = screen.getByText(/could not be copied/);
    const cleanup = screen.getByText(/the cleanup after it did not finish/);
    // The files the pages use come first: they change what a reader sees.
    expect(copy.compareDocumentPosition(cleanup)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByText('"guide/shot.png": os error 2').tagName).toBe("BDI");
    expect(screen.getByText("Access is denied. (os error 5)").tagName).toBe("BDI");
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("reports a failed document export with its reason", () => {
    render(<ExportNotice {...defaultProps} notice={{ kind: "failed", reason: "disk full" }} />);
    const notice = screen.getByRole("alert");
    expect(notice).toHaveTextContent("The export failed.");
    expect(notice).toHaveTextContent("disk full");
  });

  it("reports a failed website export with its reason", () => {
    render(<ExportNotice {...defaultProps} notice={{ kind: "siteFailed", reason: "boom" }} />);
    const notice = screen.getByRole("alert");
    expect(notice).toHaveTextContent("The website export failed.");
    expect(notice).toHaveTextContent("boom");
  });

  it("explains a destination refused for sitting inside the workspace", () => {
    render(<ExportNotice {...defaultProps} notice={{ kind: "insideWorkspace" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a folder outside it.");
  });

  it("isolates the reason so a path keeps its order in a right-to-left sentence", () => {
    render(<ExportNotice {...defaultProps} notice={{ kind: "failed", reason: "/out/a.html" }} />);
    expect(screen.getByText("/out/a.html").tagName).toBe("BDI");
  });

  it("announces a copied share link politely, saying who can read it", () => {
    render(<ExportNotice {...defaultProps} notice={{ kind: "linkCopied" }} />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("anyone who has the link can read it");
  });

  it("raises a share link that could not be made as an alert", () => {
    render(<ExportNotice {...defaultProps} notice={{ kind: "linkTooLong" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("too large to share as a link");
  });

  it("dismisses on click", () => {
    const onDismiss = vi.fn();
    render(<ExportNotice {...defaultProps} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss export notice" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("is marked so the exporter never captures it in the output", () => {
    render(<ExportNotice {...defaultProps} />);
    expect(screen.getByRole("alert")).toHaveAttribute("data-export-ignore", "true");
  });

  it("re-translates the open notice when the language switches", async () => {
    render(<ExportNotice {...defaultProps} />);
    await act(async () => {
      await i18n.changeLanguage("de");
    });
    const notice = screen.getByRole("alert");
    expect(notice).toHaveTextContent("Die Website wurde exportiert");
    // The reason is not translated; it rides along as written.
    expect(notice).toHaveTextContent("Access is denied. (os error 5)");
  });
});
