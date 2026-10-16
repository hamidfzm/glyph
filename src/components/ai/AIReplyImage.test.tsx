import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AIReplyImage } from "./AIReplyImage";

const quotedUrls = ["https://img.test/chart.png"];

describe("AIReplyImage", () => {
  it("loads an image whose URL the document named", () => {
    render(<AIReplyImage quotedUrls={quotedUrls} src="https://img.test/chart.png" alt="chart" />);
    expect(screen.getByRole("img", { name: "chart" })).toHaveAttribute(
      "src",
      "https://img.test/chart.png",
    );
  });

  it("shows any other image as text, a near match included", () => {
    const { container } = render(
      <AIReplyImage
        quotedUrls={quotedUrls}
        src="https://img.test/chart.png?d=secret"
        alt="chart"
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("chart")).toHaveAttribute(
      "title",
      "https://img.test/chart.png?d=secret",
    );
  });

  it("shows an image without a URL as text", () => {
    const { container } = render(<AIReplyImage quotedUrls={quotedUrls} alt="chart" />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("chart")).toBeInTheDocument();
  });
});
