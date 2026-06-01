import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ErrorFallback } from "./ErrorFallback";

describe("ErrorFallback", () => {
  it("renders the recovery message", () => {
    render(<ErrorFallback />);
    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
  });
});
