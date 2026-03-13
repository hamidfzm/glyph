import { useState, useEffect, useCallback, useRef } from "react";

interface TTSOptions {
  voice: string;
  speed: number;
}

interface TTSState {
  speaking: boolean;
  available: boolean;
  voices: SpeechSynthesisVoice[];
}

export function useTTS(options: TTSOptions) {
  const [state, setState] = useState<TTSState>({
    speaking: false,
    available: typeof window !== "undefined" && "speechSynthesis" in window,
    voices: [],
  });
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Load voices
  useEffect(() => {
    if (!state.available) return;

    const loadVoices = () => {
      const voices = speechSynthesis.getVoices();
      setState((prev) => ({ ...prev, voices }));
    };

    loadVoices();
    speechSynthesis.addEventListener("voiceschanged", loadVoices);
    return () => speechSynthesis.removeEventListener("voiceschanged", loadVoices);
  }, [state.available]);

  const speak = useCallback(
    (text: string) => {
      if (!state.available) return;

      speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = optionsRef.current.speed;

      // Find matching voice
      if (optionsRef.current.voice) {
        const voices = speechSynthesis.getVoices();
        const match = voices.find(
          (v) =>
            v.name.toLowerCase().includes(optionsRef.current.voice.toLowerCase()) ||
            v.lang.toLowerCase().includes(optionsRef.current.voice.toLowerCase()),
        );
        if (match) utterance.voice = match;
      }

      utterance.onstart = () => setState((prev) => ({ ...prev, speaking: true }));
      utterance.onend = () => setState((prev) => ({ ...prev, speaking: false }));
      utterance.onerror = () => setState((prev) => ({ ...prev, speaking: false }));

      speechSynthesis.speak(utterance);
    },
    [state.available],
  );

  const stop = useCallback(() => {
    if (!state.available) return;
    speechSynthesis.cancel();
    setState((prev) => ({ ...prev, speaking: false }));
  }, [state.available]);

  return { ...state, speak, stop };
}
