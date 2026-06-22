import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceNoticeBanner } from "./WorkspaceNoticeBanner";

describe("WorkspaceNoticeBanner", () => {
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
});
