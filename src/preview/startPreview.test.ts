import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/lib/i18n";
import { type PreviewHost, startPreview } from "./startPreview";

vi.mock("./renderPreview", () => ({
  renderPreview: vi.fn((content: string, { dark }: { dark: boolean }) =>
    Promise.resolve(`<p>${content} in ${dark ? "dark" : "light"}</p>`),
  ),
}));

const { renderPreview } = await import("./renderPreview");

function stubHost() {
  const listeners: Array<(event: { data: unknown }) => void> = [];
  const host: PreviewHost = {
    addEventListener: (_type, listener) => listeners.push(listener),
  };
  return {
    host,
    post: (data: unknown) => {
      for (const listener of listeners) listener({ data });
    },
  };
}

function stubDarkQuery(matches: boolean) {
  const listeners: Array<() => void> = [];
  const query = {
    matches,
    addEventListener: (_type: string, listener: () => void) => listeners.push(listener),
  } as unknown as MediaQueryList;
  return {
    query,
    switchTheme(dark: boolean) {
      (query as { matches: boolean }).matches = dark;
      for (const listener of listeners) listener();
    },
  };
}

function start(language = "en", dark = false) {
  const root = document.createElement("main");
  document.body.append(root);
  const { host, post } = stubHost();
  const { query, switchTheme } = stubDarkQuery(dark);
  startPreview({ root, host, darkQuery: query, language });
  return { root, post, switchTheme };
}

const document_ = { kind: "document", content: "# Hi", baseUrl: "https://glyph-document.example/" };

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  document.body.replaceChildren();
  document.documentElement.classList.remove("dark");
  await i18n.changeLanguage("en");
});

describe("startPreview", () => {
  it("renders a posted document into the root", async () => {
    const { root, post } = start();
    post(document_);
    await vi.waitFor(() => expect(root.textContent).toContain("# Hi in light"));
    expect(root.querySelector("article")?.className).toBe("markdown-body");
  });

  it("follows the Windows theme and re-renders on a switch", async () => {
    const { root, post, switchTheme } = start("en", true);
    post(document_);
    await vi.waitFor(() => expect(root.textContent).toContain("in dark"));
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    switchTheme(false);
    await vi.waitFor(() => expect(root.textContent).toContain("in light"));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("keeps the newest render when an older one finishes late", async () => {
    let resolveFirst: ((html: string) => void) | undefined;
    vi.mocked(renderPreview)
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockImplementationOnce(() => Promise.resolve("<p>newest</p>"));

    const { root, post, switchTheme } = start();
    post(document_);
    switchTheme(true);
    await vi.waitFor(() => expect(root.textContent).toBe("newest"));

    resolveFirst?.("<p>stale</p>");
    await Promise.resolve();
    expect(root.textContent).toBe("newest");
  });

  it("shows a localized notice for a file over the size cap", async () => {
    const { root, post } = start("de");
    post({ kind: "tooLarge", bytes: 5 * 1024 * 1024 });
    await vi.waitFor(() => expect(root.querySelector(".preview-notice")).not.toBeNull());
    expect(root.textContent).toContain("zu groß");
    expect(root.textContent).toContain("5");
    expect(document.documentElement.lang).toBe("de");
  });

  it("shows a notice for a file it cannot read", async () => {
    const { root, post } = start();
    post({ kind: "unreadable" });
    await vi.waitFor(() =>
      expect(root.textContent).toBe(i18n.t("preview.unreadable", { lng: "en" })),
    );
  });

  it("shows a notice when rendering throws", async () => {
    vi.mocked(renderPreview).mockRejectedValueOnce(new Error("broken"));
    const { root, post } = start();
    post(document_);
    await vi.waitFor(() => expect(root.textContent).toBe(i18n.t("preview.failed", { lng: "en" })));
  });

  it("ignores a message it does not recognise", async () => {
    const { root, post } = start();
    post({ kind: "whatever" });
    await Promise.resolve();
    expect(root.childNodes).toHaveLength(0);
    expect(renderPreview).not.toHaveBeenCalled();
  });
});
