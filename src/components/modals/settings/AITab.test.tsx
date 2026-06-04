import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { SettingsContext, type SettingsContextValue } from "@/contexts/SettingsContext";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings";
import { AITab } from "./AITab";

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

function withProvider(provider: Settings["ai"]["provider"]): Settings {
  return { ...DEFAULT_SETTINGS, ai: { ...DEFAULT_SETTINGS.ai, provider } };
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
    const { updateSettings } = setup(withProvider("claude"));

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
    setup(withProvider("openai"));
    expect(screen.getByPlaceholderText("sk-...")).toBeInTheDocument();
  });

  it("with Ollama: edits the server URL", () => {
    const { updateSettings } = setup(withProvider("ollama"));
    fireEvent.change(screen.getByPlaceholderText("http://localhost:11434"), {
      target: { value: "http://host:1234" },
    });
    expect(updateSettings).toHaveBeenCalledWith("ai.ollamaUrl", "http://host:1234");
  });
});
