import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CHUNK_LOAD_TIMEOUT_MS } from "@/test/chunkLoadTimeout";
import { WorkspaceSettingsModal } from "./lazyWorkspaceSettings";

// The real modal drags in sync + site-export configuration; this test only
// exercises the lazy() + Suspense wrapper, i.e. that the chunk resolves.
vi.mock("./WorkspaceSettingsModal", () => ({
  WorkspaceSettingsModal: () => <div data-testid="workspace-settings-modal" />,
}));

describe("lazyWorkspaceSettings", { timeout: CHUNK_LOAD_TIMEOUT_MS }, () => {
  it("lazily renders the WorkspaceSettingsModal", async () => {
    render(<WorkspaceSettingsModal open onClose={() => {}} tab="website" onTabChange={() => {}} />);
    await waitFor(
      () => expect(screen.getByTestId("workspace-settings-modal")).toBeInTheDocument(),
      {
        timeout: CHUNK_LOAD_TIMEOUT_MS,
      },
    );
  });
});
