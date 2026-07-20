import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WikilinkAnchor } from "./WikilinkAnchor";

// The popover's own behaviour is covered in WikilinkPreview.test.tsx; here it is
// a marker so the tests can assert purely on hover timing and click routing.
vi.mock("./WikilinkPreview", () => ({
  WikilinkPreview: ({ target }: { target: string }) => <div data-testid="preview">{target}</div>,
}));

type AnchorProps = React.ComponentProps<typeof WikilinkAnchor>;

const defaultProps: AnchorProps = {
  wikilinkTarget: "Note",
  path: "/w/Note.md",
  broken: false,
  onOpenWikilink: vi.fn(),
};

function renderAnchor(props: Partial<AnchorProps> = {}) {
  render(
    <WikilinkAnchor {...defaultProps} {...props}>
      Note
    </WikilinkAnchor>,
  );
  return screen.getByText("Note");
}

describe("WikilinkAnchor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("previews the target only after the hover delay elapses", () => {
    const link = renderAnchor();

    fireEvent.mouseEnter(link);
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByTestId("preview")).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByTestId("preview")).toHaveTextContent("Note");
  });

  it("skips the preview when the pointer leaves before the delay", () => {
    const link = renderAnchor();

    fireEvent.mouseEnter(link);
    act(() => vi.advanceTimersByTime(200));
    fireEvent.mouseLeave(link);
    act(() => vi.advanceTimersByTime(1000));

    expect(screen.queryByTestId("preview")).not.toBeInTheDocument();
  });

  it("keeps the preview up briefly so the pointer can reach it", () => {
    const link = renderAnchor();

    fireEvent.mouseEnter(link);
    act(() => vi.advanceTimersByTime(400));
    fireEvent.mouseLeave(link);
    act(() => vi.advanceTimersByTime(100));
    expect(screen.getByTestId("preview")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(100));
    expect(screen.queryByTestId("preview")).not.toBeInTheDocument();
  });

  it("opens the note on click, heading and all", () => {
    const onOpenWikilink = vi.fn();
    const link = renderAnchor({ heading: "Section", onOpenWikilink });

    fireEvent.click(link);
    expect(onOpenWikilink).toHaveBeenCalledWith("/w/Note.md", "Section");
  });

  it("does nothing when a broken link is clicked", () => {
    const onOpenWikilink = vi.fn();
    const link = renderAnchor({ path: undefined, broken: true, onOpenWikilink });

    fireEvent.click(link);
    expect(onOpenWikilink).not.toHaveBeenCalled();
    expect(link).toHaveAttribute("aria-disabled", "true");
  });

  it("dismisses the preview once the link is clicked", () => {
    const link = renderAnchor();

    fireEvent.mouseEnter(link);
    act(() => vi.advanceTimersByTime(400));
    fireEvent.click(link);

    expect(screen.queryByTestId("preview")).not.toBeInTheDocument();
  });
});
