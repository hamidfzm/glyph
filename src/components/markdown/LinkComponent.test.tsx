import { openUrl } from "@tauri-apps/plugin-opener";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsContext } from "../../contexts/SettingsContext";
import { DEFAULT_SETTINGS } from "../../lib/settings";
import { LinkComponent, type LinkComponentProps } from "./LinkComponent";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn() }));

function renderLink(props: Partial<LinkComponentProps>) {
  return render(
    <SettingsContext
      value={{
        settings: DEFAULT_SETTINGS,
        updateSettings: vi.fn(),
        resetSettings: vi.fn(),
        loaded: true,
      }}
    >
      <LinkComponent {...props}>link text</LinkComponent>
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

    const { container } = renderLink({ href: "#section-one" });
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

    const { container } = renderLink({ href: "#caf%C3%A9" });
    fireEvent.click(container.querySelector("a") as HTMLAnchorElement);

    expect(scroll).toHaveBeenCalled();
    target.remove();
  });

  it("does nothing when the target id is missing", () => {
    const { container } = renderLink({ href: "#does-not-exist" });
    const anchor = container.querySelector("a") as HTMLAnchorElement;
    expect(() => fireEvent.click(anchor)).not.toThrow();
  });
});

describe("LinkComponent wikilinks", () => {
  it("invokes onOpenWikilink with the resolved path on click", () => {
    const onOpen = vi.fn();
    const { container } = renderLink({
      onOpenWikilink: onOpen,
      ...({
        "data-wikilink": "Cooking",
        "data-wikilink-path": "/vault/Cooking.md",
      } as Record<string, string>),
    });
    const anchor = container.querySelector("a") as HTMLAnchorElement;
    fireEvent.click(anchor);

    expect(onOpen).toHaveBeenCalledWith("/vault/Cooking.md", undefined);
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("forwards the heading argument", () => {
    const onOpen = vi.fn();
    const { container } = renderLink({
      onOpenWikilink: onOpen,
      ...({
        "data-wikilink": "Cooking",
        "data-wikilink-path": "/vault/Cooking.md",
        "data-wikilink-heading": "Recipes",
      } as Record<string, string>),
    });
    fireEvent.click(container.querySelector("a") as HTMLAnchorElement);

    expect(onOpen).toHaveBeenCalledWith("/vault/Cooking.md", "Recipes");
  });

  it("does not call onOpenWikilink for broken wikilinks", () => {
    const onOpen = vi.fn();
    const { container } = renderLink({
      onOpenWikilink: onOpen,
      ...({
        "data-wikilink": "Missing",
        "data-wikilink-broken": "",
      } as Record<string, string>),
    });
    const anchor = container.querySelector("a") as HTMLAnchorElement;
    fireEvent.click(anchor);

    expect(onOpen).not.toHaveBeenCalled();
    expect(openUrl).not.toHaveBeenCalled();
    expect(anchor.getAttribute("aria-disabled")).toBe("true");
  });

  it("never opens the URL for wikilinks even with a non-anchor href", () => {
    const onOpen = vi.fn();
    const { container } = renderLink({
      href: "https://example.com",
      onOpenWikilink: onOpen,
      ...({
        "data-wikilink": "Cooking",
        "data-wikilink-path": "/vault/Cooking.md",
      } as Record<string, string>),
    });
    fireEvent.click(container.querySelector("a") as HTMLAnchorElement);

    expect(openUrl).not.toHaveBeenCalled();
    expect(onOpen).toHaveBeenCalled();
  });
});
