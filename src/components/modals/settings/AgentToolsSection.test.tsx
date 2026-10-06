import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsContext, type SettingsContextValue } from "@/contexts/SettingsContext";
import { useAgentWriteTools } from "@/hooks/useAgentWriteTools";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings";
import strings from "@/locales/en/settings.json";
import { AgentToolsSection } from "./AgentToolsSection";

vi.mock("@/hooks/useAgentWriteTools", () => ({ useAgentWriteTools: vi.fn() }));

// The names the Rust registry gives its write tools: `mcp::tests` holds the
// registry to the same file, so a tool added there without its strings fails
// here.
const WRITE_TOOLS: string[] = JSON.parse(
  readFileSync(path.join(process.cwd(), "src-tauri", "fixtures", "mcp-write-tools.json"), "utf-8"),
);

function setup(enabled: string[] = []) {
  const updateSettings = vi.fn();
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    ai: { ...DEFAULT_SETTINGS.ai, agentWriteTools: enabled },
  };
  const value: SettingsContextValue = {
    settings,
    updateSettings,
    resetSettings: vi.fn(),
    flushSettings: async () => true,
    loaded: true,
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
  );
  const view = render(<AgentToolsSection />, { wrapper });
  return { updateSettings, ...view };
}

describe("AgentToolsSection", () => {
  beforeEach(() => {
    vi.mocked(useAgentWriteTools).mockReturnValue(WRITE_TOOLS);
  });

  it("offers one toggle per write tool, all off by default", () => {
    setup();

    expect(screen.getByText(/can always read your open workspaces/)).toBeInTheDocument();
    const toggles = screen.getAllByRole("checkbox");
    expect(toggles).toHaveLength(WRITE_TOOLS.length);
    for (const toggle of toggles) expect(toggle).not.toBeChecked();
    expect(DEFAULT_SETTINGS.ai.agentWriteTools).toEqual([]);
  });

  it("has a label and a description for every tool the registry names", () => {
    expect(Object.keys(strings.ai.agentTools.tools)).toEqual(WRITE_TOOLS);
    for (const entry of Object.values(strings.ai.agentTools.tools)) {
      expect(entry.label).not.toBe("");
      expect(entry.description).not.toBe("");
    }
  });

  it("turning one tool on turns on that tool alone", async () => {
    const { updateSettings } = setup(["update_task"]);

    expect(screen.getByRole("checkbox", { name: "Check off tasks" })).toBeChecked();
    await userEvent.click(screen.getByRole("checkbox", { name: "Rename notes" }));

    expect(updateSettings).toHaveBeenCalledExactlyOnceWith("ai.agentWriteTools", [
      "update_task",
      "rename_note",
    ]);
  });

  it("turning a tool off removes only its name", async () => {
    const { updateSettings } = setup(["patch_note", "update_task", "move_note"]);

    await userEvent.click(screen.getByRole("checkbox", { name: "Check off tasks" }));

    expect(updateSettings).toHaveBeenCalledExactlyOnceWith("ai.agentWriteTools", [
      "patch_note",
      "move_note",
    ]);
  });

  it("renders nothing where there is no server to offer tools", () => {
    vi.mocked(useAgentWriteTools).mockReturnValue([]);
    const { container } = setup();
    expect(container).toBeEmptyDOMElement();
  });
});
