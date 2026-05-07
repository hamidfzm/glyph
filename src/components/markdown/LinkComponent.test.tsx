import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsContext } from "../../contexts/SettingsContext";
import { DEFAULT_SETTINGS } from "../../lib/settings";
import { LinkComponent } from "./LinkComponent";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn() }));

function renderLink(href: string) {
  return render(
    <SettingsContext
      value={{
        settings: DEFAULT_SETTINGS,
        updateSettings: vi.fn(),
        resetSettings: vi.fn(),
        loaded: true,
      }}
    >
      <LinkComponent href={href}>link text</LinkComponent>
    </SettingsContext>,
  );
}

describe("LinkComponent hash links", () => {
  it("scrolls to the matching id when an in-document anchor is clicked", () => {
    const target = document.createElement("h2");
    target.id = "section-one";
    const scroll = vi.fn();
    target.scrollIntoView = scroll;
    document.body.appendChild(target);

    const { container } = renderLink("#section-one");
    const anchor = container.querySelector("a") as HTMLAnchorElement;
    fireEvent.click(anchor);

    expect(scroll).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    target.remove();
  });

  it("decodes percent-encoded slugs before lookup", () => {
    const target = document.createElement("h2");
    target.id = "café";
    const scroll = vi.fn();
    target.scrollIntoView = scroll;
    document.body.appendChild(target);

    const { container } = renderLink("#caf%C3%A9");
    fireEvent.click(container.querySelector("a") as HTMLAnchorElement);

    expect(scroll).toHaveBeenCalled();
    target.remove();
  });

  it("does nothing when the target id is missing", () => {
    const { container } = renderLink("#does-not-exist");
    const anchor = container.querySelector("a") as HTMLAnchorElement;
    expect(() => fireEvent.click(anchor)).not.toThrow();
  });
});
