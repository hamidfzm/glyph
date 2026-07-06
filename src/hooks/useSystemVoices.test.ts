import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSystemVoices } from "./useSystemVoices";

function stubSpeechSynthesis(voices: Array<{ name: string }>) {
  const listeners: Record<string, () => void> = {};
  const synth = {
    getVoices: vi.fn(() => voices),
    addEventListener: vi.fn((event: string, cb: () => void) => {
      listeners[event] = cb;
    }),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal("speechSynthesis", synth);
  return { synth, listeners };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useSystemVoices", () => {
  it("returns the platform voices and refreshes on voiceschanged", () => {
    const voices = [{ name: "Ava" }];
    const { synth, listeners } = stubSpeechSynthesis(voices);
    const { result } = renderHook(() => useSystemVoices());
    expect(result.current).toEqual([{ name: "Ava" }]);

    synth.getVoices.mockReturnValue([{ name: "Ava" }, { name: "Yara" }]);
    act(() => listeners.voiceschanged?.());
    expect(result.current).toHaveLength(2);
  });

  it("returns an empty list when speech synthesis is unavailable", () => {
    const { result } = renderHook(() => useSystemVoices());
    expect(result.current).toEqual([]);
  });
});
