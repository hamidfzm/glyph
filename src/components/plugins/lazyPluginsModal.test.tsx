import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CHUNK_LOAD_TIMEOUT_MS } from "@/test/chunkLoadTimeout";
import { PluginsModal } from "./lazyPluginsModal";

// The real modal drags in the whole marketplace; this test only exercises the
// lazy() + Suspense wrapper, i.e. that the chunk resolves and props flow.
vi.mock("./PluginsModal", () => ({
  PluginsModal: () => <div data-testid="plugins-modal" />,
}));

describe("lazyPluginsModal", { timeout: CHUNK_LOAD_TIMEOUT_MS }, () => {
  it("lazily renders the PluginsModal", async () => {
    render(<PluginsModal onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("plugins-modal")).toBeInTheDocument(), {
      timeout: CHUNK_LOAD_TIMEOUT_MS,
    });
  });
});
