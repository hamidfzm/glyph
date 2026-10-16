import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AIImagePlaceholder } from "./AIImagePlaceholder";

describe("AIImagePlaceholder", () => {
  it("shows the alt text with the URL as a title, and loads nothing", () => {
    const { container } = render(
      <AIImagePlaceholder alt=" chart " src="https://attacker.example/c?d=secret" />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("chart")).toHaveAttribute(
      "title",
      "https://attacker.example/c?d=secret",
    );
  });

  it("falls back to the URL without alt text, and to nothing without either", () => {
    render(<AIImagePlaceholder alt="" src="https://example.test/x.png" />);
    expect(screen.getByText("https://example.test/x.png")).toBeInTheDocument();

    const { container } = render(<AIImagePlaceholder />);
    expect(container.querySelector(".ai-msg-image")).toHaveTextContent("");
  });
});
