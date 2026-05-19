import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { useReadAloudController } from "./useReadAloudController";

// Mock useTTS so we can drive .speaking and assert speak/stop calls.
const ttsHandle = {
  speak: vi.fn(),
  stop: vi.fn(),
  speaking: false,
  available: true,
};
vi.mock("@/hooks/useTTS", () => ({
  useTTS: () => ttsHandle,
}));

describe("useReadAloudController", () => {
  it("speaks the supplied content when not already speaking", () => {
    ttsHandle.speaking = false;
    ttsHandle.speak.mockClear();
    ttsHandle.stop.mockClear();
    const { result } = renderHook(() =>
      useReadAloudController(DEFAULT_SETTINGS.ai, () => "hello world"),
    );
    act(() => {
      result.current.toggle();
    });
    expect(ttsHandle.speak).toHaveBeenCalledWith("hello world");
    expect(ttsHandle.stop).not.toHaveBeenCalled();
  });

  it("stops when already speaking and ignores the content getter", () => {
    ttsHandle.speaking = true;
    ttsHandle.speak.mockClear();
    ttsHandle.stop.mockClear();
    const getContent = vi.fn(() => "should not be read");
    const { result } = renderHook(() => useReadAloudController(DEFAULT_SETTINGS.ai, getContent));
    act(() => {
      result.current.toggle();
    });
    expect(ttsHandle.stop).toHaveBeenCalled();
    expect(ttsHandle.speak).not.toHaveBeenCalled();
    expect(getContent).not.toHaveBeenCalled();
  });

  it("is a no-op when there is no content to speak", () => {
    ttsHandle.speaking = false;
    ttsHandle.speak.mockClear();
    const { result } = renderHook(() => useReadAloudController(DEFAULT_SETTINGS.ai, () => null));
    act(() => {
      result.current.toggle();
    });
    expect(ttsHandle.speak).not.toHaveBeenCalled();
  });
});
