import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExportToasts } from "./ExportToasts";

const defaultProps = {
  exporting: null,
  siteProgress: null,
  notice: null,
  onDismissNotice: vi.fn(),
};

describe("ExportToasts", () => {
  it("renders nothing while no export is running or waiting to be read", () => {
    const { container } = render(<ExportToasts {...defaultProps} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the progress of a document export", () => {
    render(<ExportToasts {...defaultProps} exporting="pdf" />);
    expect(screen.getByRole("status")).toHaveTextContent("Exporting PDF…");
  });

  it("shows the page count of a website export", () => {
    render(<ExportToasts {...defaultProps} siteProgress={{ done: 2, total: 5 }} />);
    expect(screen.getByRole("status")).toHaveTextContent("Exporting page 2 of 5…");
  });

  it("keeps an unread notice beside the progress of a later export", () => {
    render(
      <ExportToasts
        {...defaultProps}
        exporting="html"
        notice={{ kind: "failed", reason: "disk full" }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("disk full");
    expect(screen.getByRole("status")).toHaveTextContent("Exporting HTML…");
  });

  it("keeps the whole stack off the printed page", () => {
    const { container } = render(<ExportToasts {...defaultProps} exporting="pdf" />);
    expect(container.firstChild).toHaveAttribute("data-print-hide", "true");
  });

  it("dismisses the notice through its close button", () => {
    const onDismissNotice = vi.fn();
    render(
      <ExportToasts
        {...defaultProps}
        notice={{ kind: "insideWorkspace" }}
        onDismissNotice={onDismissNotice}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Dismiss export notice" }));
    expect(onDismissNotice).toHaveBeenCalledOnce();
  });
});
