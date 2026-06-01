import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NotebookSource } from "./NotebookSource";

const props = { searchOpen: false, onSearchClose: () => {} };

describe("NotebookSource", () => {
  it("renders the raw JSON inside a code block", () => {
    const json = '{"cells": [], "nbformat": 4}';
    const { container } = render(<NotebookSource content={json} {...props} />);
    // The JSON is fenced and rendered as a <code> block by the markdown viewer.
    const code = container.querySelector("code");
    expect(code?.textContent).toContain('"nbformat": 4');
  });

  it("shows the read-only banner", () => {
    render(<NotebookSource content="{}" {...props} />);
    expect(screen.getByText(/read-only source view/i)).toBeInTheDocument();
  });

  it("does not render an editable textarea", () => {
    const { container } = render(<NotebookSource content="{}" {...props} />);
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.querySelector('[contenteditable="true"]')).toBeNull();
  });
});
