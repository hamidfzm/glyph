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

  it("locates exactly the quote's text, never the button label", () => {
    mockLocate.mockReturnValue(true);
    render(<AIQuoteBlock>quoted passage</AIQuoteBlock>);
    fireEvent.click(screen.getByRole("button", { name: "Show in document" }));
    expect(mockLocate).toHaveBeenCalledWith("quoted passage");
  });

  it("treats a text-less quote as not found", () => {
    mockLocate.mockReturnValue(false);
    const { container } = render(<AIQuoteBlock />);
    const content = container.querySelector(".ai-quote-content") as HTMLElement;
    Object.defineProperty(content, "textContent", { get: () => null });
    fireEvent.click(screen.getByRole("button", { name: "Show in document" }));
    expect(mockLocate).toHaveBeenCalledWith("");
    expect(screen.getByRole("button", { name: "Not found in document" })).toBeInTheDocument();
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
