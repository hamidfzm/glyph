import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TabsContext, type TabsContextValue } from "@/contexts/TabsContext";
import {
  useWorkspaceRoot,
  WorkspaceRootContext,
  WorkspaceRootProvider,
} from "./WorkspaceRootContext";

function Probe() {
  return <span data-testid="root">{useWorkspaceRoot() ?? "none"}</span>;
}

describe("useWorkspaceRoot", () => {
  it("returns undefined when no provider is mounted", () => {
    render(<Probe />);
    expect(screen.getByTestId("root")).toHaveTextContent("none");
  });

  it("returns the value from WorkspaceRootContext", () => {
    render(
      <WorkspaceRootContext.Provider value="/ws">
        <Probe />
      </WorkspaceRootContext.Provider>,
    );
    expect(screen.getByTestId("root")).toHaveTextContent("/ws");
  });
});

describe("WorkspaceRootProvider", () => {
  it("publishes the open workspace root from the tabs context", () => {
    const tabs = { workspace: { root: "/repo" } } as unknown as TabsContextValue;
    render(
      <TabsContext.Provider value={tabs}>
        <WorkspaceRootProvider>
          <Probe />
        </WorkspaceRootProvider>
      </TabsContext.Provider>,
    );
    expect(screen.getByTestId("root")).toHaveTextContent("/repo");
  });

  it("publishes undefined when no folder workspace is open", () => {
    const tabs = { workspace: null } as unknown as TabsContextValue;
    render(
      <TabsContext.Provider value={tabs}>
        <WorkspaceRootProvider>
          <Probe />
        </WorkspaceRootProvider>
      </TabsContext.Provider>,
    );
    expect(screen.getByTestId("root")).toHaveTextContent("none");
  });
});
