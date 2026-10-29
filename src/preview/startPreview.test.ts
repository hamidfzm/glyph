import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/lib/i18n";
import type { RenderedPreview } from "./renderPreview";
import { type PreviewHost, startPreview } from "./startPreview";

vi.mock("./renderPreview", () => ({
  renderPreview: vi.fn((content: string, { dark }: { dark: boolean }) =>
    Promise.resolve(rendered(`<p>${content} in ${dark ? "dark" : "light"}</p>`)),
  ),
}));

function rendered(html: string, droppedImages = 0): RenderedPreview {
  return { html, droppedImages };
}

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
    expect(renderPreview).toHaveBeenCalledWith("# Hi", {
      dark: false,
      images: "https://glyph-document.example/",
    });
  });

  it("applies the dark theme before any document arrives", () => {
    start("en", true);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
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
    let resolveFirst: ((result: RenderedPreview) => void) | undefined;
    vi.mocked(renderPreview)
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockImplementationOnce(() => Promise.resolve(rendered("<p>newest</p>")));

    const { root, post, switchTheme } = start();
    post(document_);
    switchTheme(true);
    await vi.waitFor(() => expect(root.textContent).toBe("newest"));

    resolveFirst?.(rendered("<p>stale</p>"));
    // A macrotask: the stale write would land several microtasks later.
    await new Promise((resolve) => setTimeout(resolve, 0));
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

describe("startPreview without a host", () => {
  function startDirect() {
    const root = document.createElement("main");
    document.body.append(root);
    const { query, switchTheme } = stubDarkQuery(false);
    const preview = startPreview({ root, darkQuery: query, language: "en" });
    return { root, preview, switchTheme };
  }

  const webDocument = { kind: "document", content: "# Web", baseUrl: null } as const;

  it("renders a document shown directly, with no folder behind it", async () => {
    const { root, preview } = startDirect();
    preview.show(webDocument);
    await vi.waitFor(() => expect(root.textContent).toContain("# Web in light"));
    expect(renderPreview).toHaveBeenCalledWith("# Web", { dark: false, images: null });
  });

  it("takes the relative images of a document with no folder from the one picked", async () => {
    const { preview } = startDirect();
    const picked = vi.fn(() => null);
    await preview.show(webDocument, picked);
    expect(renderPreview).toHaveBeenCalledWith("# Web", { dark: false, images: picked });
  });

  it("settles with how many relative images became alt text", async () => {
    vi.mocked(renderPreview).mockResolvedValueOnce(rendered("<p>web</p>", 2));
    const { root, preview } = startDirect();
    expect(await preview.show(webDocument)).toBe(2);
    expect(root.textContent).toBe("web");
    expect(await preview.show({ kind: "invalidLink" })).toBe(0);
    expect(await preview.show(null)).toBe(0);
  });

  it("settles a show that another one replaced with null", async () => {
    let resolveFirst: ((result: RenderedPreview) => void) | undefined;
    vi.mocked(renderPreview)
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce(rendered("<p>second</p>", 1));
    const { root, preview } = startDirect();
    const first = preview.show(webDocument);
    await vi.waitFor(() => expect(resolveFirst).toBeDefined());
    const second = preview.show({ kind: "document", content: "# Second", baseUrl: null });
    expect(await first).toBeNull();
    expect(await second).toBe(1);
    resolveFirst?.(rendered("<p>first</p>", 3));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.textContent).toBe("second");
  });

  it("settles with the render a theme switch started in its place", async () => {
    let resolveFirst: ((result: RenderedPreview) => void) | undefined;
    vi.mocked(renderPreview)
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce(rendered("<p>dark</p>", 2));
    const { preview, switchTheme } = startDirect();
    const shown = preview.show(webDocument);
    await vi.waitFor(() => expect(resolveFirst).toBeDefined());
    switchTheme(true);
    expect(await shown).toBe(2);
  });

  it("shows a notice for a link it could not decode", async () => {
    const { root, preview } = startDirect();
    preview.show({ kind: "invalidLink" });
    await vi.waitFor(() =>
      expect(root.textContent).toBe(i18n.t("preview.invalidLink", { lng: "en" })),
    );
  });

  it("clears the root for null, even while an earlier render is in flight", async () => {
    let resolveRender: ((result: RenderedPreview) => void) | undefined;
    vi.mocked(renderPreview).mockImplementationOnce(
      () => new Promise((resolve) => (resolveRender = resolve)),
    );
    const { root, preview } = startDirect();
    preview.show({ kind: "document", content: "# Late", baseUrl: null });
    await vi.waitFor(() => expect(resolveRender).toBeDefined());

    preview.show(null);
    resolveRender?.(rendered("<p>late</p>"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.childNodes).toHaveLength(0);
  });

  it("renders the message shown last when several arrive while translations load", async () => {
    const { root, preview } = startDirect();
    preview.show({ kind: "document", content: "# First", baseUrl: null });
    preview.show({ kind: "unreadable" });
    await vi.waitFor(() =>
      expect(root.textContent).toBe(i18n.t("preview.unreadable", { lng: "en" })),
    );
    expect(root.textContent).not.toContain("First");
  });

  it("settles ready once translations have loaded", async () => {
    const { preview } = startDirect();
    await preview.ready;
    expect(i18n.language).toBe("en");
  });
});
