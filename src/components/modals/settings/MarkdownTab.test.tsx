import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownTab } from "./MarkdownTab";

const updateSettings = vi.fn();

vi.mock("@/hooks/useSettings", async (importOriginal) => {
  const { DEFAULT_SETTINGS } = await import("@/lib/settings");
  return {
    ...(await importOriginal<object>()),
    useSettings: () => ({
      settings: {
        ...DEFAULT_SETTINGS,
        markdown: { ...DEFAULT_SETTINGS.markdown, math: false },
      },
      updateSettings,
      loaded: true,
      resetSettings: vi.fn(),
    }),
  };
});

describe("MarkdownTab", () => {
  it("renders a toggle per markdown feature reflecting current state", () => {
    render(<MarkdownTab />);
    const toggles = screen.getAllByRole("checkbox");
    expect(toggles).toHaveLength(5);
    // gfm on, math off (per the mocked settings).
    expect(toggles[0]).toBeChecked();
    expect(toggles[1]).not.toBeChecked();
  });

  it("writes the toggled feature back through updateSettings", () => {
    render(<MarkdownTab />);
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    expect(updateSettings).toHaveBeenCalledWith("markdown.math", true);
  });
});
