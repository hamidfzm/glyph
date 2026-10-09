import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/lib/i18n";
import { ExportNotice } from "./ExportNotice";

const defaultProps = {
  notice: { kind: "pruneFailed", reason: "Access is denied. (os error 5)" } as const,
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

  it("reports a failed export with its reason", () => {
    render(<ExportNotice {...defaultProps} notice={{ kind: "failed", reason: "disk full" }} />);
    const notice = screen.getByRole("alert");
    expect(notice).toHaveTextContent("The website export failed.");
    expect(notice).toHaveTextContent("disk full");
  });

  it("explains a destination refused for sitting inside the workspace", () => {
    render(<ExportNotice {...defaultProps} notice={{ kind: "insideWorkspace" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a folder outside it.");
  });

  it("isolates the reason so a path keeps its order in a right-to-left sentence", () => {
    render(<ExportNotice {...defaultProps} notice={{ kind: "failed", reason: "/out/a.html" }} />);
    expect(screen.getByText("/out/a.html").tagName).toBe("BDI");
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
