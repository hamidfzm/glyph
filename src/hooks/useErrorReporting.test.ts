import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useErrorReporting } from "./useErrorReporting";

const enableTelemetry = vi.fn();
const disableTelemetry = vi.fn();

vi.mock("@/lib/telemetry", () => ({
  enableTelemetry: () => enableTelemetry(),
  disableTelemetry: () => disableTelemetry(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useErrorReporting", () => {
  it("does nothing until settings are loaded", () => {
    renderHook(() => useErrorReporting(true, false));
    expect(enableTelemetry).not.toHaveBeenCalled();
    expect(disableTelemetry).not.toHaveBeenCalled();
  });

  it("enables telemetry when loaded and opted in", () => {
    renderHook(() => useErrorReporting(true, true));
    expect(enableTelemetry).toHaveBeenCalledTimes(1);
    expect(disableTelemetry).not.toHaveBeenCalled();
  });

  it("disables telemetry when loaded and opted out", () => {
    renderHook(() => useErrorReporting(false, true));
    expect(disableTelemetry).toHaveBeenCalledTimes(1);
    expect(enableTelemetry).not.toHaveBeenCalled();
  });

  it("reacts to the toggle flipping", () => {
    const { rerender } = renderHook(({ enabled }) => useErrorReporting(enabled, true), {
      initialProps: { enabled: false },
    });
    expect(disableTelemetry).toHaveBeenCalledTimes(1);

    rerender({ enabled: true });
    expect(enableTelemetry).toHaveBeenCalledTimes(1);
  });
});
