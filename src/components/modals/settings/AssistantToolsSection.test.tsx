import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { SettingsContext, type SettingsContextValue } from "@/contexts/SettingsContext";
import { type AISettings, DEFAULT_SETTINGS } from "@/lib/settings";
import { AssistantToolsSection } from "./AssistantToolsSection";

function setup(
  provider: AISettings["provider"],
  assistantTools = DEFAULT_SETTINGS.ai.assistantTools,
) {
  const updateSettings = vi.fn();
  const value: SettingsContextValue = {
    settings: { ...DEFAULT_SETTINGS, ai: { ...DEFAULT_SETTINGS.ai, provider, assistantTools } },
    updateSettings,
    resetSettings: vi.fn(),
    flushSettings: async () => true,
    loaded: true,
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
  );
  return { ...render(<AssistantToolsSection />, { wrapper }), updateSettings };
}

describe("AssistantToolsSection", () => {
  it("shows nothing while no provider is set", () => {
    const { container } = setup("none");
    expect(container).toBeEmptyDOMElement();
  });

  it("explains what the assistant may read and that it goes to a cloud provider", () => {
    setup("openai");
    expect(screen.getByText(/the text of any note/)).toBeInTheDocument();
    expect(screen.getByText(/sent to OpenAI along with your question/)).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Let the assistant read notes" }),
    ).not.toBeChecked();
  });

  it("says where a local model's reads go", () => {
    setup("ollama");
    expect(screen.getByText(/the Ollama server set above/)).toBeInTheDocument();
  });

  it("turns the tools on or off for the current provider only", async () => {
    const { updateSettings } = setup("claude", { claude: false, openai: true, ollama: true });
    await userEvent.click(screen.getByRole("checkbox", { name: "Let the assistant read notes" }));
    expect(updateSettings).toHaveBeenCalledWith("ai.assistantTools.claude", true);
  });
});
