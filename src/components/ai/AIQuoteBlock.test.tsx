import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { locateInDocument } from "@/lib/documentHighlight";
import { AIQuoteBlock } from "./AIQuoteBlock";

vi.mock("@/lib/documentHighlight", () => ({ locateInDocument: vi.fn() }));

const mockLocate = vi.mocked(locateInDocument);

beforeEach(() => {
  mockLocate.mockReset();
});

describe("AIQuoteBlock", () => {
  it("renders the quote with a locate button", () => {
    render(<AIQuoteBlock>quoted passage</AIQuoteBlock>);
    expect(screen.getByText("quoted passage")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show in document" })).toBeInTheDocument();
  });

  it("locates the blockquote's text (without the button label) on click", () => {
    mockLocate.mockReturnValue(true);
    render(<AIQuoteBlock>quoted passage</AIQuoteBlock>);
    fireEvent.click(screen.getByRole("button", { name: "Show in document" }));
    expect(mockLocate).toHaveBeenCalledTimes(1);
    expect(mockLocate.mock.calls[0][0]).toContain("quoted passage");
  });

  it("shows temporary not-found feedback when the quote is not in the document", () => {
    vi.useFakeTimers();
    mockLocate.mockReturnValue(false);
    render(<AIQuoteBlock>made-up quote</AIQuoteBlock>);

    fireEvent.click(screen.getByRole("button", { name: "Show in document" }));
    expect(screen.getByRole("button", { name: "Not found in document" })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole("button", { name: "Show in document" })).toBeInTheDocument();
    vi.useRealTimers();
  });
});
