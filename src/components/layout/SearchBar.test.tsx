import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SearchBar } from "./SearchBar";

const defaultProps = {
  query: "",
  onQueryChange: vi.fn(),
  matchCount: 0,
  currentMatch: 0,
  onNext: vi.fn(),
  onPrev: vi.fn(),
  onClose: vi.fn(),
};

describe("SearchBar", () => {
  it("renders input and navigation buttons", () => {
    render(<SearchBar {...defaultProps} />);
    expect(screen.getByRole("textbox", { name: "Search" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous match" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next match" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close search" })).toBeInTheDocument();
  });

  it("auto-focuses input on mount", () => {
    render(<SearchBar {...defaultProps} />);
    expect(screen.getByRole("textbox", { name: "Search" })).toHaveFocus();
  });

  it("shows match count when query is non-empty", () => {
    render(<SearchBar {...defaultProps} query="test" matchCount={5} currentMatch={2} />);
    expect(screen.getByText("2 of 5")).toBeInTheDocument();
  });

  it("shows no results when query has no matches", () => {
    render(<SearchBar {...defaultProps} query="test" matchCount={0} currentMatch={0} />);
    expect(screen.getByText("No results")).toBeInTheDocument();
  });

  it("hides match count when query is empty", () => {
    render(<SearchBar {...defaultProps} />);
    expect(screen.queryByText("No results")).not.toBeInTheDocument();
    expect(screen.queryByText(/of/)).not.toBeInTheDocument();
  });

  it("calls onNext on Enter", () => {
    const onNext = vi.fn();
    render(<SearchBar {...defaultProps} onNext={onNext} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onNext).toHaveBeenCalledOnce();
  });

  it("calls onPrev on Shift+Enter", () => {
    const onPrev = vi.fn();
    render(<SearchBar {...defaultProps} onPrev={onPrev} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", shiftKey: true });
    expect(onPrev).toHaveBeenCalledOnce();
  });

  it("calls onClose on Escape", () => {
    const onClose = vi.fn();
    render(<SearchBar {...defaultProps} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("disables navigation buttons when no matches", () => {
    render(<SearchBar {...defaultProps} query="test" matchCount={0} />);
    expect(screen.getByRole("button", { name: "Previous match" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next match" })).toBeDisabled();
  });

  it("calls onQueryChange when typing", () => {
    const onQueryChange = vi.fn();
    render(<SearchBar {...defaultProps} onQueryChange={onQueryChange} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "hello" } });
    expect(onQueryChange).toHaveBeenCalledWith("hello");
  });
});
