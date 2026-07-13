import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DefaultAppSection } from "./DefaultAppSection";

const { setDefaultMock } = vi.hoisted(() => ({ setDefaultMock: vi.fn() }));
vi.mock("@/lib/defaultApp", () => ({ setDefaultMarkdownApp: setDefaultMock }));

describe("DefaultAppSection", () => {
  beforeEach(() => {
    setDefaultMock.mockReset();
  });

  it("invokes the command and shows the outcome message on click", async () => {
    setDefaultMock.mockResolvedValue("openedSettings");
    render(<DefaultAppSection />);

    await userEvent.click(screen.getByRole("button", { name: "Set Glyph as default" }));

    expect(setDefaultMock).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(
        screen.getByText("Opened Default Apps settings. Choose Glyph for Markdown files."),
      ).toBeInTheDocument(),
    );
  });

  it("shows guidance when the platform has no programmatic path", async () => {
    setDefaultMock.mockResolvedValue("guidance");
    render(<DefaultAppSection />);

    await userEvent.click(screen.getByRole("button", { name: "Set Glyph as default" }));

    await waitFor(() =>
      expect(screen.getByText(/right-click a Markdown file/i)).toBeInTheDocument(),
    );
  });
});
