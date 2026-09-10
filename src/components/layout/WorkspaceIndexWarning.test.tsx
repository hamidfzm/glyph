import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TabsContext, type TabsContextValue } from "@/contexts/TabsContext";
import { COMPLETE_INDEX_STATUS, COMPLETE_SCAN, type ScanStatus } from "@/lib/workspaceScan";
import { WorkspaceIndexWarning } from "./WorkspaceIndexWarning";

function renderWith(status: ScanStatus, which: "files" | "vault" = "files") {
  const indexStatus = { ...COMPLETE_INDEX_STATUS, [which]: status };
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

  it("renders nothing while both walks are complete", () => {
    const { container } = renderWith(COMPLETE_SCAN);
    expect(container.firstChild).toBeNull();
  });

  it("shows the indicator with the file-limit message when the scan truncated", () => {
    renderWith({ truncated: true, reason: "fileLimit", limit: 10000 });
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Index incomplete");
    expect(status.getAttribute("title")).toContain("10000");
  });

  it("falls back to a zero limit when the scan status carries none", () => {
    renderWith({ truncated: true, reason: "fileLimit", limit: null });
    expect(screen.getByRole("status").getAttribute("title")).toContain("first 0 documents");
  });

  it("uses the depth message when the note index hit the depth cap", () => {
    renderWith({ truncated: true, reason: "depthLimit", limit: 32 }, "vault");
    expect(screen.getByRole("status").getAttribute("title")).toContain("32 levels");
  });
});
