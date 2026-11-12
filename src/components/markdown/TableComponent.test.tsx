import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { LightboxProvider } from "@/contexts/LightboxProvider";
import { LinkComponent } from "./LinkComponent";
import { TableComponent } from "./TableComponent";

const { scrollToHeading } = vi.hoisted(() => ({ scrollToHeading: vi.fn(() => true) }));
vi.mock("@/lib/scrollToHeading", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/scrollToHeading")>()),
  scrollToHeading,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ isFullscreen: () => Promise.resolve(false) }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(undefined)) }));

function rows(): ReactNode {
  return (
    <>
      <thead>
        <tr>
          <th>Name</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <LinkComponent href="#cell">cell link</LinkComponent>
          </td>
        </tr>
      </tbody>
    </>
  );
}

function renderInDocument() {
  return render(
    <LightboxProvider>
      <div className="markdown-body">
        <TableComponent>{rows()}</TableComponent>
      </div>
    </LightboxProvider>,
  );
}

function expandButton() {
  return screen.getByRole("button", { name: "Expand table" });
}

describe("TableComponent", () => {
  it("wraps the table in a scroller, so wide columns stay reachable", () => {
    const { container } = render(<TableComponent>{rows()}</TableComponent>);
    const wrapper = container.querySelector(".markdown-table-wrapper");
    expect(wrapper).not.toBeNull();
    expect(wrapper?.firstElementChild?.tagName).toBe("TABLE");
  });

  it("passes table attributes through, but not react-markdown's node", () => {
    const node = { type: "element" as const, tagName: "table", properties: {}, children: [] };
    const { container } = render(
      <TableComponent data-testid="t" node={node}>
        {rows()}
      </TableComponent>,
    );
    const table = container.querySelector("table");
    expect(table?.getAttribute("data-testid")).toBe("t");
    expect(table?.hasAttribute("node")).toBe(false);
  });

  it("offers no expand button outside a lightbox provider", () => {
    render(<TableComponent>{rows()}</TableComponent>);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("opens the same rows in the lightbox and refocuses the button on Escape", () => {
    renderInDocument();
    const button = expandButton();
    expect(button).toHaveAttribute("data-print-hide", "true");
    fireEvent.click(button);

    const dialog = screen.getByRole("dialog", { name: "Table viewer" });
    expect(within(dialog).getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "cell link" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it.each(["Enter", " "])("opens from the keyboard with %j", async (key) => {
    const user = userEvent.setup();
    renderInDocument();
    expandButton().focus();
    await user.keyboard(key === " " ? "[Space]" : `{${key}}`);
    expect(screen.getByRole("dialog", { name: "Table viewer" })).toBeInTheDocument();
  });

  it("refocuses the button when the close button closes the lightbox", () => {
    renderInDocument();
    fireEvent.click(expandButton());
    fireEvent.click(screen.getByRole("button", { name: "Close (Esc)" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(expandButton()).toHaveFocus();
  });

  it("refocuses the button when the backdrop closes the lightbox", () => {
    renderInDocument();
    fireEvent.click(expandButton());
    fireEvent.click(screen.getByRole("dialog"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(expandButton()).toHaveFocus();
  });

  it("follows a cell link as the document does, closing the lightbox", () => {
    scrollToHeading.mockClear();
    renderInDocument();
    fireEvent.click(expandButton());
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("link", { name: "cell link" }));
    expect(scrollToHeading).toHaveBeenCalledWith("cell");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(expandButton()).toHaveFocus();
  });
});
