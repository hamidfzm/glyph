import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsContext, type SettingsContextValue } from "@/contexts/SettingsContext";
import { useOllamaModels } from "@/hooks/useOllamaModels";
import { useSystemVoices } from "@/hooks/useSystemVoices";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings";
import { AITab } from "./AITab";

vi.mock("@/hooks/useOllamaModels", () => ({ useOllamaModels: vi.fn() }));
vi.mock("@/hooks/useSystemVoices", () => ({ useSystemVoices: vi.fn() }));

const mockModels = vi.mocked(useOllamaModels);
const mockVoices = vi.mocked(useSystemVoices);

beforeEach(() => {
  mockModels.mockReturnValue({ models: [], status: "idle" });
  mockVoices.mockReturnValue([]);
});

function setup(settings: Settings = DEFAULT_SETTINGS) {
  const updateSettings = vi.fn();
  const value: SettingsContextValue = {
    settings,
    updateSettings,
    resetSettings: vi.fn(),
    loaded: true,
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
  );
  render(<AITab />, { wrapper });
  return { updateSettings };
}

function withAI(ai: Partial<Settings["ai"]>): Settings {
  return { ...DEFAULT_SETTINGS, ai: { ...DEFAULT_SETTINGS.ai, ...ai } };
}

describe("AITab", () => {
  it("with no provider: changes provider and edits text-to-speech", () => {
    const { updateSettings } = setup();

    // Provider "none" renders only the provider select (no model combobox).
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "claude" } });
    expect(updateSettings).toHaveBeenCalledWith("ai.provider", "claude");

    fireEvent.change(screen.getByPlaceholderText("Default system voice"), {
      target: { value: "Alex" },
    });
    expect(updateSettings).toHaveBeenCalledWith("ai.ttsVoice", "Alex");

    fireEvent.change(screen.getByRole("slider"), { target: { value: "1.5" } });
    expect(updateSettings).toHaveBeenCalledWith("ai.ttsSpeed", 1.5);
  });

  it("with Claude: edits the API key and model, and lists suggestions", () => {
    const { updateSettings } = setup(withAI({ provider: "claude" }));

    fireEvent.change(screen.getByPlaceholderText("sk-ant-..."), {
      target: { value: "sk-ant-xyz" },
    });
    expect(updateSettings).toHaveBeenCalledWith("ai.apiKeys", { claude: "sk-ant-xyz" });

    fireEvent.change(screen.getByPlaceholderText("Select or type model name"), {
      target: { value: "claude-test" },
    });
    expect(updateSettings).toHaveBeenCalledWith("ai.model", "claude-test");

    // Suggestions datalist is populated for providers with known models.
    expect(document.querySelector("#model-suggestions option")).not.toBeNull();
  });

  it("with OpenAI: shows the OpenAI key placeholder", () => {
    setup(withAI({ provider: "openai" }));
    expect(screen.getByPlaceholderText("sk-...")).toBeInTheDocument();
  });

  it("with Ollama: edits the server URL", () => {
    const { updateSettings } = setup(withAI({ provider: "ollama" }));
    fireEvent.change(screen.getByPlaceholderText("http://localhost:11434"), {
      target: { value: "http://host:1234" },
    });
    expect(updateSettings).toHaveBeenCalledWith("ai.ollamaUrl", "http://host:1234");
  });

  it("with a reachable Ollama server: model becomes a dropdown of installed models", () => {
    mockModels.mockReturnValue({ models: ["gemma2:latest", "llama3.2:8b"], status: "ok" });
    const { updateSettings } = setup(withAI({ provider: "ollama" }));

    expect(mockModels).toHaveBeenCalledWith(DEFAULT_SETTINGS.ai.ollamaUrl, true);
    const select = screen.getAllByRole("combobox")[1];
    expect([...select.querySelectorAll("option")].map((o) => o.value)).toEqual([
      "",
      "gemma2:latest",
      "llama3.2:8b",
    ]);
    fireEvent.change(select, { target: { value: "gemma2:latest" } });
    expect(updateSettings).toHaveBeenCalledWith("ai.model", "gemma2:latest");
    expect(screen.getByText("Connected to Ollama. Installed models: 2")).toBeInTheDocument();
  });

  it("keeps a custom model tag selectable when it is not installed", () => {
    mockModels.mockReturnValue({ models: ["gemma2:latest"], status: "ok" });
    setup(withAI({ provider: "ollama", model: "my-custom:tag" }));
    const select = screen.getAllByRole("combobox")[1] as HTMLSelectElement;
    expect(select.value).toBe("my-custom:tag");
    expect([...select.querySelectorAll("option")].map((o) => o.value)).toEqual([
      "my-custom:tag",
      "gemma2:latest",
    ]);
  });

  it("with an unreachable Ollama server: falls back to free text and says so", () => {
    mockModels.mockReturnValue({ models: [], status: "error" });
    setup(withAI({ provider: "ollama" }));

    expect(screen.getByPlaceholderText("Select or type model name")).toBeInTheDocument();
    const options = [...document.querySelectorAll("#model-suggestions option")];
    expect(options.length).toBeGreaterThan(0);
    expect(screen.getByRole("status").textContent).toContain("Cannot reach the Ollama server");
  });

  it("shows a checking notice while the server is being probed", () => {
    mockModels.mockReturnValue({ models: [], status: "loading" });
    setup(withAI({ provider: "ollama" }));
    expect(screen.getByRole("status").textContent).toContain("Checking the Ollama server");
  });

  it("lists system voices in a dropdown when available", () => {
    mockVoices.mockReturnValue([
      { name: "Ava", lang: "en-US" } as SpeechSynthesisVoice,
      { name: "Yara", lang: "fa-IR" } as SpeechSynthesisVoice,
    ]);
    const { updateSettings } = setup();

    const voiceSelect = screen.getAllByRole("combobox")[1];
    expect(screen.getByText("Ava (en-US)")).toBeInTheDocument();
    fireEvent.change(voiceSelect, { target: { value: "Yara" } });
    expect(updateSettings).toHaveBeenCalledWith("ai.ttsVoice", "Yara");
  });

  it("keeps a saved voice selectable when the system no longer lists it", () => {
    mockVoices.mockReturnValue([{ name: "Ava", lang: "en-US" } as SpeechSynthesisVoice]);
    setup(withAI({ ttsVoice: "Gone Voice" }));
    const voiceSelect = screen.getAllByRole("combobox")[1] as HTMLSelectElement;
    expect(voiceSelect.value).toBe("Gone Voice");
  });

  it("disables autocorrect on the model, server URL, and voice inputs", () => {
    mockModels.mockReturnValue({ models: [], status: "error" });
    setup(withAI({ provider: "ollama" }));
    for (const input of [
      screen.getByPlaceholderText("Select or type model name"),
      screen.getByPlaceholderText("http://localhost:11434"),
      screen.getByPlaceholderText("Default system voice"),
    ]) {
      expect(input).toHaveAttribute("spellcheck", "false");
      expect(input).toHaveAttribute("autocorrect", "off");
      expect(input).toHaveAttribute("autocapitalize", "off");
    }
  });
});
