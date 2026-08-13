import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureException } from "@/lib/telemetry";
import { ErrorBoundary } from "./ErrorBoundary";

vi.mock("@/lib/telemetry", () => ({ captureException: vi.fn() }));

function Bomb(): never {
  throw new Error("render exploded");
}

describe("ErrorBoundary", () => {
  beforeEach(() => {
    // React logs caught render errors to console.error; keep test output clean.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders its children when nothing throws", () => {
    render(
      <ErrorBoundary fallback={<div>fallback</div>}>
        <div>content</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText("content")).toBeInTheDocument();
    expect(screen.queryByText("fallback")).not.toBeInTheDocument();
  });

  it("renders the fallback and reports the error when a child throws", () => {
    render(
      <ErrorBoundary fallback={<div>fallback</div>}>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByText("fallback")).toBeInTheDocument();
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "render exploded" }),
      expect.objectContaining({
        contexts: expect.objectContaining({ react: expect.anything() }),
      }),
    );
  });
});
