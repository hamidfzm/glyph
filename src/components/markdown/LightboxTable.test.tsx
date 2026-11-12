import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LightboxTableItem } from "@/lib/lightbox";
import { Lightbox } from "./Lightbox";
import { LinkComponent } from "./LinkComponent";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ isFullscreen: () => Promise.resolve(false) }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(undefined)) }));
const { scrollToHeading } = vi.hoisted(() => ({ scrollToHeading: vi.fn(() => true) }));
vi.mock("@/lib/scrollToHeading", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/scrollToHeading")>()),
  scrollToHeading,
}));

function tableItem(): LightboxTableItem {
  return {
    kind: "table",
    dir: "rtl",
    content: (
      <>
        <thead>
          <tr>
            <th>Name</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Row</td>
            <td>
              <LinkComponent href="#notes">notes</LinkComponent>
            </td>
          </tr>
        </tbody>
      </>
    ),
  };
}

const defaultProps = {
  items: [tableItem()],
  index: 0,
  onIndexChange: vi.fn(),
  onClose: vi.fn(),
};

function stubWidths(table: number, scroller: number) {
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(table);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(scroller);
}

function tableZoom() {
  return screen.getByRole("table").closest<HTMLElement>(".lightbox-table")!.style.zoom;
}

function scroller() {
  return screen.getByRole("table").closest<HTMLElement>(".lightbox-table-scroller")!;
}

describe("Lightbox with a table", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.getSelection()?.removeAllRanges();
  });

  it("renders the table rows in a markdown body, in the document's direction", () => {
    render(<Lightbox {...defaultProps} />);
    const dialog = screen.getByRole("dialog", { name: "Table viewer" });
    expect(screen.getByRole("columnheader", { name: "Notes" })).toBeInTheDocument();
    expect(dialog.querySelector(".lightbox-table")).toHaveClass("markdown-body");
    expect(scroller()).toHaveAttribute("dir", "rtl");
    // A table opens alone: no image navigation.
    expect(screen.queryByLabelText("Next image (→)")).not.toBeInTheDocument();
  });

  it("fits a wide table to the width of its scroll box", () => {
    stubWidths(4000, 2000);
    render(<Lightbox {...defaultProps} />);
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(tableZoom()).toBe("0.5");
  });

  it("fits a narrow table at actual size rather than enlarging it", () => {
    stubWidths(400, 2000);
    render(<Lightbox {...defaultProps} />);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("zooms by reflowing the table, from the toolbar, keys, and ctrl+wheel", () => {
    render(<Lightbox {...defaultProps} />);
    fireEvent.click(screen.getByLabelText("Zoom in (+)"));
    expect(tableZoom()).toBe("1.25");

    fireEvent.keyDown(window, { key: "-" });
    expect(tableZoom()).toBe("1");

    // happy-dom's WheelEvent drops the ctrlKey init field; set it explicitly.
    const zoomWheel = new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true });
    Object.defineProperty(zoomWheel, "ctrlKey", { value: true });
    fireEvent(screen.getByRole("table"), zoomWheel);
    expect(screen.getByText("116%")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "1" });
    expect(tableZoom()).toBe("1");
  });

  it("focuses the table's scroll box so the keys scroll it, not the document", () => {
    render(<Lightbox {...defaultProps} />);
    expect(scroller()).toHaveFocus();
  });

  it("closes on a click in the empty space around the table", () => {
    const onClose = vi.fn();
    render(<Lightbox {...defaultProps} onClose={onClose} />);
    fireEvent.click(scroller());
    expect(onClose).toHaveBeenCalled();
  });

  it("follows a link and closes, so the link's target is in view", () => {
    scrollToHeading.mockClear();
    const onClose = vi.fn();
    render(<Lightbox {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole("link", { name: "notes" }));
    expect(scrollToHeading).toHaveBeenCalledWith("notes");
    expect(onClose).toHaveBeenCalled();
  });

  it("stays open for a broken wikilink, which leads nowhere", () => {
    const onClose = vi.fn();
    const broken: LightboxTableItem = {
      kind: "table",
      dir: "ltr",
      content: (
        <tbody>
          <tr>
            <td>
              <a href="#missing-note" aria-disabled="true">
                missing note
              </a>
            </td>
          </tr>
        </tbody>
      ),
    };
    render(<Lightbox {...defaultProps} items={[broken]} onClose={onClose} />);
    fireEvent.click(screen.getByRole("link", { name: "missing note" }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("stays open when a text selection is dragged out onto the backdrop", () => {
    const onClose = vi.fn();
    render(<Lightbox {...defaultProps} onClose={onClose} />);
    const dialog = screen.getByRole("dialog");
    const range = document.createRange();
    range.selectNodeContents(screen.getByRole("cell", { name: "Row" }));
    window.getSelection()?.addRange(range);

    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();

    window.getSelection()?.removeAllRanges();
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalled();
  });

  it("does not close for a click inside the table", () => {
    const onClose = vi.fn();
    render(<Lightbox {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole("cell", { name: "Row" }));
    expect(onClose).not.toHaveBeenCalled();
  });
});
