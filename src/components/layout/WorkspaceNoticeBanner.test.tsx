import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/lib/i18n";
import { WorkspaceNoticeBanner } from "./WorkspaceNoticeBanner";

describe("WorkspaceNoticeBanner", () => {
  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("renders nothing when there is no notice", () => {
    const { container } = render(<WorkspaceNoticeBanner notice={null} onDismiss={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("resolves the notice key against the workspace namespace and dismisses on click", () => {
    const onDismiss = vi.fn();
    render(
      <WorkspaceNoticeBanner
        notice={{ key: "notice.nestedUnderGit", values: { path: "/repo" } }}
        onDismiss={onDismiss}
      />,
    );
    // Resolved from workspace/en.json with the path interpolated.
    expect(screen.getByText(/git repository at "\/repo"/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss workspace notice" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("re-translates the open notice when the language switches", async () => {
    render(
      <WorkspaceNoticeBanner
        notice={{ key: "notice.nestedUnderGit", values: { path: "/repo" } }}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText(/git repository at "\/repo"/)).toBeInTheDocument();

    await act(async () => {
      await i18n.changeLanguage("fa");
    });

    // The same open banner now reads the Persian translation, not English.
    expect(screen.queryByText(/git repository at/)).not.toBeInTheDocument();
    expect(screen.getByText(/مخزن git/)).toBeInTheDocument();
  });
});
