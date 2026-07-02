import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AIChatEdgeButton } from "./AIChatEdgeButton";

describe("AIChatEdgeButton", () => {
  it("opens the chat on click and is labelled for screen readers", () => {
    const onClick = vi.fn();
    render(<AIChatEdgeButton onClick={onClick} />);
    const button = screen.getByRole("button", { name: "AI Chat" });
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalled();
    expect(button).toHaveAttribute("data-print-hide", "true");
  });
});
