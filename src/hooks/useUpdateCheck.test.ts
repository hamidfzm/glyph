import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkForUpdate } from "@/lib/updateCheck";
import { useUpdateCheck } from "./useUpdateCheck";

vi.mock("@/lib/updateCheck", () => ({
  checkForUpdate: vi.fn(),
}));

const mockedCheck = vi.mocked(checkForUpdate);

const AVAILABLE = {
  status: "available" as const,
  latestVersion: "0.9.0",
  currentVersion: "0.8.1",
  url: "https://example.com/0.9.0",
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("useUpdateCheck", () => {
  it("surfaces an available update once the check resolves", async () => {
    mockedCheck.mockResolvedValue(AVAILABLE);

    const { result } = renderHook(() => useUpdateCheck(true, true));

    await waitFor(() => expect(result.current.update).not.toBeNull());
    expect(result.current.update).toEqual({
      latestVersion: "0.9.0",
      currentVersion: "0.8.1",
      url: "https://example.com/0.9.0",
    });
  });

  it("stays null when already up to date", async () => {
    mockedCheck.mockResolvedValue({ status: "current", currentVersion: "0.8.1" });

    const { result } = renderHook(() => useUpdateCheck(true, true));

    await waitFor(() => expect(mockedCheck).toHaveBeenCalled());
    expect(result.current.update).toBeNull();
  });

  it("does not check until settings have loaded", () => {
    mockedCheck.mockResolvedValue({ status: "error" });

    renderHook(() => useUpdateCheck(true, false));

    expect(mockedCheck).not.toHaveBeenCalled();
  });

  it("does not check when the feature is disabled", () => {
    mockedCheck.mockResolvedValue({ status: "error" });

    renderHook(() => useUpdateCheck(false, true));

    expect(mockedCheck).not.toHaveBeenCalled();
  });

  it("checks at most once across re-renders", async () => {
    mockedCheck.mockResolvedValue(AVAILABLE);

    const { rerender } = renderHook(() => useUpdateCheck(true, true));
    await waitFor(() => expect(mockedCheck).toHaveBeenCalledTimes(1));

    rerender();
    rerender();
    expect(mockedCheck).toHaveBeenCalledTimes(1);
  });

  it("dismiss clears the surfaced update", async () => {
    mockedCheck.mockResolvedValue(AVAILABLE);

    const { result } = renderHook(() => useUpdateCheck(true, true));
    await waitFor(() => expect(result.current.update).not.toBeNull());

    act(() => result.current.dismiss());
    expect(result.current.update).toBeNull();
  });
});
