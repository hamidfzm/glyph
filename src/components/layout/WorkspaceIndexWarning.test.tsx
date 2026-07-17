import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TabsContext, type TabsContextValue } from "@/contexts/TabsContext";
import {
  COMPLETE_INDEX_STATUS,
  COMPLETE_SCAN,
  type WorkspaceIndexStatus,
} from "@/lib/workspaceScan";
import { WorkspaceIndexWarning } from "./WorkspaceIndexWarning";

function renderWith(indexStatus: WorkspaceIndexStatus) {
  return render(
    <TabsContext.Provider value={{ indexStatus } as unknown as TabsContextValue}>
      <WorkspaceIndexWarning />
    </TabsContext.Provider>,
  );
}

describe("WorkspaceIndexWarning", () => {
  it("renders nothing without a provider", () => {
    const { container } = render(<WorkspaceIndexWarning />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing while both indexes are complete", () => {
    const { container } = renderWith(COMPLETE_INDEX_STATUS);
    expect(container.firstChild).toBeNull();
  });

  it("shows the indicator with the file-limit message when the file scan truncated", () => {
    renderWith({
      files: { truncated: true, reason: "fileLimit", limit: 10000 },
      wikilinks: COMPLETE_SCAN,
    });
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Index incomplete");
    expect(status.getAttribute("title")).toContain("10000");
  });

  it("falls back to the wikilink scan's depth message", () => {
    renderWith({
      files: COMPLETE_SCAN,
      wikilinks: { truncated: true, reason: "depthLimit", limit: 32 },
    });
    expect(screen.getByRole("status").getAttribute("title")).toContain("32 levels");
  });
});
