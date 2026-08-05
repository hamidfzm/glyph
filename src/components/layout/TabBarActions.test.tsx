import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TabsContext, type TabsContextValue } from "@/contexts/TabsContext";
import type { Workspace } from "@/lib/tabs";
import { TabBarActions } from "./TabBarActions";

const WORKSPACE: Workspace = { root: "/vault", expanded: new Set(), nodes: new Map() };

function renderActions(
  opts: {
    workspace?: TabsContextValue["workspace"];
    openGraph?: TabsContextValue["openGraph"];
    onOpenPalette?: () => void;
  } = {},
) {
  const context = {
    workspace: opts.workspace === undefined ? WORKSPACE : opts.workspace,
    openGraph: opts.openGraph ?? vi.fn(),
  } as unknown as TabsContextValue;
  render(
    <TabsContext.Provider value={context}>
      <TabBarActions onOpenPalette={opts.onOpenPalette ?? vi.fn()} />
    </TabsContext.Provider>,
  );
}

describe("TabBarActions", () => {
  it("opens the command palette when its button is pressed", () => {
    const onOpenPalette = vi.fn();
    renderActions({ onOpenPalette });

    fireEvent.click(screen.getByRole("button", { name: "Command palette" }));
    expect(onOpenPalette).toHaveBeenCalledTimes(1);
  });

  it("opens the graph when its button is pressed", () => {
    const openGraph = vi.fn();
    renderActions({ openGraph });

    fireEvent.click(screen.getByRole("button", { name: "Open graph" }));
    expect(openGraph).toHaveBeenCalledTimes(1);
  });

  it("hides the graph button without a workspace, where opening it is a no-op", () => {
    renderActions({ workspace: null });

    expect(screen.queryByRole("button", { name: "Open graph" })).toBeNull();
    expect(screen.getByRole("button", { name: "Command palette" })).toBeTruthy();
  });

  it("passes no root to openGraph, so the open workspace is used", () => {
    const openGraph = vi.fn();
    renderActions({ openGraph });

    fireEvent.click(screen.getByRole("button", { name: "Open graph" }));
    expect(openGraph).toHaveBeenCalledWith();
  });
});
