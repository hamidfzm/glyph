import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LightboxProvider } from "@/contexts/LightboxProvider";
import { MarkdownContent } from "./MarkdownContent";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ isFullscreen: () => Promise.resolve(false) }),
}));

const TABLE = [
  "| Name | Note |",
  "| --- | --- |",
  "| `code` | [link](https://example.com) |",
  "",
  "![pic](https://example.com/pic.png)",
].join("\n");

describe("MarkdownContent lightbox", () => {
  it("opens a rendered GFM table, inline code and links included, in the lightbox", () => {
    render(<MarkdownContent content={TABLE} />);
    fireEvent.click(screen.getByRole("button", { name: "Expand table" }));

    const dialog = screen.getByRole("dialog", { name: "Table viewer" });
    expect(within(dialog).getByRole("columnheader", { name: "Note" })).toBeInTheDocument();
    expect(within(dialog).getByText("code").tagName).toBe("CODE");
    expect(within(dialog).getByRole("link", { name: /link/ })).toHaveAttribute(
      "href",
      "https://example.com",
    );
  });

  it("offers no lightbox when turned off, even inside a document that has one", () => {
    // A hover preview is portaled from a document's link, under its provider.
    render(
      <LightboxProvider>
        <MarkdownContent content={TABLE} lightbox={false} />
      </LightboxProvider>,
    );
    expect(screen.queryByRole("button", { name: "Expand table" })).not.toBeInTheDocument();
    expect(screen.getByAltText("pic")).not.toHaveAttribute("data-zoomable");
  });
});
