import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTTS } from "./useTTS";

interface MockUtterance {
  text: string;
  rate?: number;
  voice?: SpeechSynthesisVoice;
  onstart?: () => void;
  onend?: () => void;
  onerror?: () => void;
}

let utterances: MockUtterance[];
let cancel: ReturnType<typeof vi.fn>;
let originalSynth: typeof speechSynthesis | undefined;
let originalUtterance: typeof SpeechSynthesisUtterance | undefined;

beforeEach(() => {
  utterances = [];
  cancel = vi.fn();
  const voices: SpeechSynthesisVoice[] = [
    { name: "Alice", lang: "en-US" } as SpeechSynthesisVoice,
    { name: "Bruno", lang: "fr-FR" } as SpeechSynthesisVoice,
  ];

  originalSynth = (globalThis as { speechSynthesis?: typeof speechSynthesis }).speechSynthesis;
  originalUtterance = (globalThis as { SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance })
    .SpeechSynthesisUtterance;

  (globalThis as unknown as { speechSynthesis: object }).speechSynthesis = {
    cancel,
    speak: vi.fn((u: MockUtterance) => {
      utterances.push(u);
    }),
    getVoices: () => voices,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };

  class MockUtteranceImpl {
    text: string;
    rate = 1;
    voice?: SpeechSynthesisVoice;
    onstart?: () => void;
    onend?: () => void;
    onerror?: () => void;
    constructor(text: string) {
      this.text = text;
    }
  }
  (globalThis as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance =
    MockUtteranceImpl;
});

afterEach(() => {
  if (originalSynth) {
    (globalThis as unknown as { speechSynthesis: typeof speechSynthesis }).speechSynthesis =
      originalSynth;
  }
  if (originalUtterance) {
    (
      globalThis as unknown as { SpeechSynthesisUtterance: typeof SpeechSynthesisUtterance }
    ).SpeechSynthesisUtterance = originalUtterance;
  }
});

describe("useTTS", () => {
  it("reports availability and loads voices on mount", async () => {
    const { result } = renderHook(() => useTTS({ voice: "", speed: 1 }));
    expect(result.current.available).toBe(true);
    await act(async () => {});
    expect(result.current.voices).toHaveLength(2);
  });

  it("speak() creates an utterance and toggles speaking via onstart/onend", () => {
    const { result } = renderHook(() => useTTS({ voice: "", speed: 1.5 }));
    act(() => {
      result.current.speak("hello");
    });

    expect(utterances).toHaveLength(1);
    expect(utterances[0].text).toBe("hello");
    expect(utterances[0].rate).toBe(1.5);

    act(() => {
      utterances[0].onstart?.();
    });
    expect(result.current.speaking).toBe(true);

    act(() => {
      utterances[0].onend?.();
    });
    expect(result.current.speaking).toBe(false);
  });

  it("matches a voice by name substring", () => {
    const { result } = renderHook(() => useTTS({ voice: "alice", speed: 1 }));
    act(() => {
      result.current.speak("hi");
    });
    expect(utterances[0].voice?.name).toBe("Alice");
  });

  it("matches a voice by language substring", () => {
    const { result } = renderHook(() => useTTS({ voice: "fr-FR", speed: 1 }));
    act(() => {
      result.current.speak("salut");
    });
    expect(utterances[0].voice?.name).toBe("Bruno");
  });

  it("onerror resets speaking to false", () => {
    const { result } = renderHook(() => useTTS({ voice: "", speed: 1 }));
    act(() => {
      result.current.speak("hi");
    });
    act(() => {
      utterances[0].onstart?.();
    });
    expect(result.current.speaking).toBe(true);
    act(() => {
      utterances[0].onerror?.();
    });
    expect(result.current.speaking).toBe(false);
  });

  it("stop() cancels and resets speaking", () => {
    const { result } = renderHook(() => useTTS({ voice: "", speed: 1 }));
    act(() => {
      result.current.speak("hi");
    });
    act(() => {
      utterances[0].onstart?.();
    });
    act(() => {
      result.current.stop();
    });
    expect(cancel).toHaveBeenCalled();
    expect(result.current.speaking).toBe(false);
  });
});
