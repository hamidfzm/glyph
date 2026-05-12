import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { SettingsContext, type SettingsContextValue } from "@/contexts/SettingsContext";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { SettingsModal } from "./SettingsModal";

function withSettings(overrides: Partial<SettingsContextValue> = {}) {
  const value: SettingsContextValue = {
    settings: DEFAULT_SETTINGS,
    updateSettings: vi.fn(),
    resetSettings: vi.fn(),
    loaded: true,
    ...overrides,
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
  );
  return { value, wrapper };
}

describe("SettingsModal", () => {
  it("renders nothing when closed", () => {
    const { wrapper } = withSettings();
    const { container } = render(<SettingsModal open={false} onClose={vi.fn()} />, {
      wrapper,
    });
    expect(container.querySelector(".settings-overlay")).toBeNull();
  });

  it("renders the modal with all top-level tabs when open", () => {
    const { wrapper } = withSettings();
    render(<SettingsModal open={true} onClose={vi.fn()} />, { wrapper });

    expect(screen.getByText("Appearance")).toBeInTheDocument();
    expect(screen.getByText("Layout")).toBeInTheDocument();
    expect(screen.getByText("Behavior")).toBeInTheDocument();
    expect(screen.getByText("AI")).toBeInTheDocument();
    expect(screen.getByText("Print")).toBeInTheDocument();
  });

  it("switches the active tab when a tab button is clicked", () => {
    const { wrapper } = withSettings();
    render(<SettingsModal open={true} onClose={vi.fn()} />, { wrapper });

    fireEvent.click(screen.getByText("Layout"));
    expect(screen.getByText("Sidebars")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Behavior"));
    expect(screen.getByText("Auto-reload")).toBeInTheDocument();
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    const { wrapper } = withSettings();
    render(<SettingsModal open={true} onClose={onClose} />, { wrapper });

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onClose on other keys", () => {
    const onClose = vi.fn();
    const { wrapper } = withSettings();
    render(<SettingsModal open={true} onClose={onClose} />, { wrapper });

    fireEvent.keyDown(window, { key: "Enter" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls onClose when the backdrop is clicked but not when content is clicked", () => {
    const onClose = vi.fn();
    const { wrapper } = withSettings();
    const { container } = render(<SettingsModal open={true} onClose={onClose} />, {
      wrapper,
    });

    const overlay = container.querySelector(".settings-overlay");
    fireEvent.click(overlay as Element);
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    fireEvent.click(screen.getByText("Appearance"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("invokes updateSettings when an Appearance segmented control changes", () => {
    const updateSettings = vi.fn();
    const { wrapper } = withSettings({ updateSettings });
    render(<SettingsModal open={true} onClose={vi.fn()} />, { wrapper });

    fireEvent.click(screen.getByText("Dark"));
    expect(updateSettings).toHaveBeenCalledWith("appearance.theme", "dark");
  });

  it("clears recent files via the Behavior tab", () => {
    const updateSettings = vi.fn();
    const { wrapper } = withSettings({
      updateSettings,
      settings: {
        ...DEFAULT_SETTINGS,
        behavior: { ...DEFAULT_SETTINGS.behavior, recentFiles: ["/p/a.md", "/p/b.md"] },
      },
    });
    render(<SettingsModal open={true} onClose={vi.fn()} />, { wrapper });

    fireEvent.click(screen.getByText("Behavior"));
    fireEvent.click(screen.getByText(/Clear Recent Files/i));
    expect(updateSettings).toHaveBeenCalledWith("behavior.recentFiles", []);
  });

  it("calls resetSettings from the footer Reset button", () => {
    const resetSettings = vi.fn();
    const { wrapper } = withSettings({ resetSettings });
    render(<SettingsModal open={true} onClose={vi.fn()} />, { wrapper });

    fireEvent.click(screen.getByText("Reset to Defaults"));
    expect(resetSettings).toHaveBeenCalled();
  });
});
