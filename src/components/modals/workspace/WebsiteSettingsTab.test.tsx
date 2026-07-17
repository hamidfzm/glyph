import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WebsiteSettingsTab } from "./WebsiteSettingsTab";

vi.mock("@tauri-apps/api/core");

// The full form is exercised through WorkspaceSettingsModal.test.tsx; the
// modal only mounts the tab with a workspace open, so the no-workspace guard
// is reachable only by rendering the tab directly.
describe("WebsiteSettingsTab", () => {
  it("renders nothing without a workspace root", () => {
    const { container } = render(<WebsiteSettingsTab onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
