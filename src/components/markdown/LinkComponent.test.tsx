import { openUrl } from "@tauri-apps/plugin-opener";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsContext } from "@/contexts/SettingsContext";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings";
import { LinkComponent, type LinkComponentProps } from "./LinkComponent";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn() }));

function renderLink(props: Partial<LinkComponentProps>, settings: Settings = DEFAULT_SETTINGS) {
  return render(
    <SettingsContext
      value={{
        settings,
        updateSettings: vi.fn(),
        resetSettings: vi.fn(),
        loaded: true,
      }}
    >
      <LinkComponent {...props}>link text</LinkComponent>
    </SettingsContext>,
  );
}

// Open mode without the external-link confirmation prompt, so a fall-through to
// the browser calls openUrl synchronously (no awaited `ask`).
const NO_CONFIRM: Settings = {
  ...DEFAULT_SETTINGS,
  behavior: { ...DEFAULT_SETTINGS.behavior, confirmExternalLinks: false },
};

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
        "data-wikilink-path": "/workspace/Cooking.md",
      } as Record<string, string>),
    });
    const anchor = container.querySelector("a") as HTMLAnchorElement;
    fireEvent.click(anchor);

    expect(onOpen).toHaveBeenCalledWith("/workspace/Cooking.md", undefined);
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("forwards the heading argument", () => {
    const onOpen = vi.fn();
    const { container } = renderLink({
      onOpenWikilink: onOpen,
      ...({
        "data-wikilink": "Cooking",
        "data-wikilink-path": "/workspace/Cooking.md",
        "data-wikilink-heading": "Recipes",
      } as Record<string, string>),
    });
    fireEvent.click(container.querySelector("a") as HTMLAnchorElement);

    expect(onOpen).toHaveBeenCalledWith("/workspace/Cooking.md", "Recipes");
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
        "data-wikilink-path": "/workspace/Cooking.md",
      } as Record<string, string>),
    });
    fireEvent.click(container.querySelector("a") as HTMLAnchorElement);

    expect(openUrl).not.toHaveBeenCalled();
    expect(onOpen).toHaveBeenCalled();
  });
});

describe("LinkComponent relative file links", () => {
  it("opens a relative markdown link in the workspace", () => {
    vi.mocked(openUrl).mockClear();
    const onOpen = vi.fn();
    const { container } = renderLink({ href: "./sibling.md", onOpenRelativeFile: onOpen });
    fireEvent.click(container.querySelector("a") as HTMLAnchorElement);

    expect(onOpen).toHaveBeenCalledWith("./sibling.md");
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("opens a relative ../ canvas link in the workspace", () => {
    vi.mocked(openUrl).mockClear();
    const onOpen = vi.fn();
    const { container } = renderLink({
      href: "../diagrams/board.canvas",
      onOpenRelativeFile: onOpen,
    });
    fireEvent.click(container.querySelector("a") as HTMLAnchorElement);

    expect(onOpen).toHaveBeenCalledWith("../diagrams/board.canvas");
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("does not render the external-link icon on an intercepted relative link", () => {
    const { container } = renderLink({ href: "./sibling.md", onOpenRelativeFile: vi.fn() });
    expect(container.querySelector("svg")).toBeNull();
  });

  it("ignores a relative link to a non-markdown, non-canvas file", () => {
    vi.mocked(openUrl).mockClear();
    const onOpen = vi.fn();
    const { container } = renderLink(
      { href: "./data.txt", onOpenRelativeFile: onOpen },
      NO_CONFIRM,
    );
    fireEvent.click(container.querySelector("a") as HTMLAnchorElement);

    expect(onOpen).not.toHaveBeenCalled();
    expect(openUrl).toHaveBeenCalledWith("./data.txt");
  });

  it("falls through to the browser in single-file mode (no callback)", () => {
    vi.mocked(openUrl).mockClear();
    const { container } = renderLink({ href: "./sibling.md" }, NO_CONFIRM);
    fireEvent.click(container.querySelector("a") as HTMLAnchorElement);

    expect(openUrl).toHaveBeenCalledWith("./sibling.md");
  });

  it("does not intercept an external URL that happens to end in .md", () => {
    vi.mocked(openUrl).mockClear();
    const onOpen = vi.fn();
    const { container } = renderLink(
      { href: "https://example.com/page.md", onOpenRelativeFile: onOpen },
      NO_CONFIRM,
    );
    fireEvent.click(container.querySelector("a") as HTMLAnchorElement);

    expect(onOpen).not.toHaveBeenCalled();
    expect(openUrl).toHaveBeenCalledWith("https://example.com/page.md");
  });
});
