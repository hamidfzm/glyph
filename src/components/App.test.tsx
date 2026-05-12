import { render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { SettingsContext, type SettingsContextValue } from "@/contexts/SettingsContext";
import { DEFAULT_SETTINGS } from "@/lib/settings";

vi.mock("./editor/lazyEditor", () => ({
  MarkdownEditor: () => <div data-testid="lazy-editor" />,
  SplitView: () => <div data-testid="lazy-split" />,
}));

vi.mock("./markdown/MarkdownViewer", () => ({
  MarkdownViewer: () => <div data-testid="markdown-viewer" />,
}));

vi.mock("./modals/SettingsModal", () => ({
  SettingsModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="settings-modal" /> : null,
}));

vi.mock("./modals/AIPanel", () => ({
  AIPanel: () => null,
}));

import { App } from "./App";

function withProviders(overrides: Partial<SettingsContextValue> = {}) {
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

describe("App", () => {
  it("renders the empty state when there are no tabs", async () => {
    const { wrapper } = withProviders();
    const { findByText } = render(<App />, { wrapper });

    expect(await findByText(/Open File/i)).toBeInTheDocument();
    expect(await findByText(/Open Folder/i)).toBeInTheDocument();
  });

  it("mounts without crashing when the empty state is showing", async () => {
    const { wrapper } = withProviders();
    const { container } = render(<App />, { wrapper });

    await waitFor(() => {
      expect(container.firstChild).not.toBeNull();
    });
    expect(container.textContent).toMatch(/Open a Markdown file/i);
  });

  it("does not crash when settings.loaded is false", async () => {
    const { wrapper } = withProviders({ loaded: false });
    const { container } = render(<App />, { wrapper });

    await waitFor(() => {
      expect(container.firstChild).not.toBeNull();
    });
  });
});
