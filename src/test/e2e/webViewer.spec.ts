import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";
import { expect, type Page, test } from "@playwright/test";

// Smoke test for the web viewer (`pnpm build:web`). A shared link puts a
// document anyone can write on a public origin, and in a browser the page's
// meta CSP is the only thing between it and the network: there is no native
// host to block requests, as the Explorer and Quick Look previews have. This
// opens hostile documents in the built page under WebKit and checks that.

const DIST = fileURLToPath(new URL("../../../dist-web/", import.meta.url));
const ORIGIN = "https://glyph-web-smoke.test";
const VIEWER = `${ORIGIN}/view/`;
const REMOTE = "https://glyph-remote-smoke.test";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

// Encoded with zlib rather than the page's own codec, so the test also pins
// the link format against an independent implementation.
function link(markdown: string | Uint8Array): string {
  return `${VIEWER}#v1.${deflateRawSync(markdown).toString("base64url")}`;
}

const HOSTILE = `# Hostile

<script>window.__pwned = "script"</script>
<img src="x" onerror="window.__pwned = 'onerror'">

[Run it](javascript:window.__pwned='link')

![remote](${REMOTE}/image.png)

<svg width="10" height="10"><image href="${REMOTE}/svg-image.png" width="10" height="10"/></svg>

<video poster="${REMOTE}/poster.png" src="${REMOTE}/video.mp4"></video>

<div class="styled" style="background-image: url(${REMOTE}/background.png); width: 10px; height: 10px"></div>

<iframe src="${REMOTE}/frame"></iframe>

[Jump](#target)

\`\`\`mermaid
%%{init: {"themeCSS": ".node rect { fill: url(${REMOTE}/theme.png) }"}}%%
flowchart LR
  B --> C
  click B href "${REMOTE}/click"
\`\`\`

\`\`\`mermaid
flowchart LR
  A@{ img: "${REMOTE}/node.png", label: "Img", pos: "t", h: 40 }
\`\`\`

\`\`\`mermaid
flowchart LR
  A -->
\`\`\`

## Target
`;

function distFiles(): Map<string, Buffer> {
  if (!existsSync(join(DIST, "index.html"))) {
    throw new Error("dist-web/index.html is missing: run `pnpm build:web` first.");
  }
  const files = new Map<string, Buffer>();
  for (const entry of readdirSync(DIST, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const absolute = join(entry.parentPath, entry.name);
    files.set(absolute.slice(DIST.length).replaceAll("\\", "/"), readFileSync(absolute));
  }
  return files;
}

/** Serves the built viewer at VIEWER; returns every request that left for another origin. */
async function serveViewer(page: Page, { withCsp = true } = {}): Promise<string[]> {
  const files = distFiles();
  const offOrigin: string[] = [];
  await page.context().route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) {
      offOrigin.push(url.href);
      return route.abort();
    }
    const name = url.pathname.slice("/view/".length) || "index.html";
    let body = files.get(name);
    if (!body) return route.fulfill({ status: 404, body: "" });
    if (name === "index.html" && !withCsp) {
      body = Buffer.from(
        body.toString("utf-8").replace(/<meta\s+http-equiv="Content-Security-Policy"[^>]*>/, ""),
      );
    }
    return route.fulfill({ contentType: CONTENT_TYPES[extname(name)], body });
  });
  return offOrigin;
}

async function openHostile(page: Page) {
  await page.goto(link(HOSTILE));
  await expect(page.locator("article.markdown-body h1")).toHaveText("Hostile");
  await expect(page.locator(".mermaid-diagram svg").first()).toBeVisible();
  // The broken diagram and the remote-image one fail to render and keep their source.
  await expect(page.locator("article.markdown-body pre code.language-mermaid")).toHaveCount(2);
}

test("a hostile shared document reaches no other origin and runs no script", async ({ page }) => {
  const offOrigin = await serveViewer(page);
  await openHostile(page);

  // The vectors survived sanitizing, so the CSP is what stopped them.
  const article = page.locator("article.markdown-body");
  await expect(article.locator("svg image[href]")).toHaveCount(1);
  await expect(article.locator("video[poster]")).toHaveCount(1);
  await expect(article.locator(".styled")).toHaveCount(1);

  expect(await page.evaluate(() => (window as { __pwned?: string }).__pwned)).toBeUndefined();
  // The sanitizer drops the javascript: href, leaving plain text to click.
  await page.getByText("Run it").click();
  expect(await page.evaluate(() => (window as { __pwned?: string }).__pwned)).toBeUndefined();
  expect(offOrigin).toEqual([]);

  // A diagram Mermaid cannot parse leaves nothing outside the viewer's own page.
  const bodyChildren = await page.evaluate(() =>
    Array.from(document.body.children, (element) => element.tagName),
  );
  expect(bodyChildren).toEqual(["HEADER", "MAIN", "MAIN"]);

  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  expect(await page.evaluate(() => document.cookie)).toBe("");
  const workers = await page.evaluate(
    async () => (await navigator.serviceWorker?.getRegistrations())?.length ?? 0,
  );
  expect(workers).toBe(0);
});

test("an in-document link scrolls without losing the shared document", async ({ page }) => {
  await serveViewer(page);
  await openHostile(page);
  const hash = await page.evaluate(() => location.hash);
  await page.getByRole("link", { name: "Jump" }).click();
  expect(await page.evaluate(() => location.hash)).toBe(hash);
  await page.reload();
  await expect(page.locator("article.markdown-body h1")).toHaveText("Hostile");
});

test("a link inside a diagram opens a new tab and leaves the viewer in place", async ({ page }) => {
  const offOrigin = await serveViewer(page);
  await openHostile(page);
  const viewerUrl = page.url();
  const popup = page.context().waitForEvent("page");
  await page.locator(".mermaid-diagram a").first().click();
  await popup;
  // The new tab's navigation is the one request that leaves; the route aborts it.
  await expect.poll(() => offOrigin).toEqual([`${REMOTE}/click`]);
  expect(page.url()).toBe(viewerUrl);
});

// The translations load from lazy chunks whose keys depend on the build's
// root, which only the built page shows; unit tests run from the repo root.
test("the viewer follows the browser's language", async ({ browser }) => {
  const context = await browser.newContext({ locale: "de-DE" });
  const page = await context.newPage();
  await serveViewer(page);
  await page.goto(VIEWER);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Markdown-Datei öffnen");
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await context.close();
});

test("Back after opening a file returns to the shared document", async ({ page }) => {
  await serveViewer(page);
  await page.goto(link("# Shared"));
  await expect(page.locator("article.markdown-body h1")).toHaveText("Shared");
  await page.setInputFiles("header input[type=file]", {
    name: "local.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Local"),
  });
  await expect(page.locator("article.markdown-body h1")).toHaveText("Local");
  await page.goBack();
  await expect(page.locator("article.markdown-body h1")).toHaveText("Shared");
});

test("prints the document alone, unclipped", async ({ page }) => {
  await serveViewer(page);
  await page.goto(link(`# Printed\n\n${"A paragraph long enough to fill pages. ".repeat(400)}`));
  await expect(page.locator("article.markdown-body h1")).toHaveText("Printed");
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("body > header")).toBeHidden();
  const preview = await page.locator("body > #preview").evaluate((element) => {
    const style = getComputedStyle(element);
    return { overflow: style.overflowY, contain: style.contain };
  });
  expect(preview).toEqual({ overflow: "visible", contain: "none" });
});

// Calibration: without the page's CSP the same document does reach the
// network, one request per vector, so the test above cannot pass vacuously.
test("the harness sees the requests once the CSP is gone", async ({ page }) => {
  const offOrigin = await serveViewer(page, { withCsp: false });
  await openHostile(page);
  for (const file of ["svg-image.png", "poster.png", "background.png"]) {
    await expect.poll(() => offOrigin).toContain(`${REMOTE}/${file}`);
  }
});

test("a decompression bomb is refused before WebKit inflates all of it", async ({ page }) => {
  await serveViewer(page);
  // Counts what the page feeds WebKit's own decompressor.
  await page.addInitScript(() => {
    const Real = DecompressionStream;
    const counted = window as unknown as { __consumed: number };
    counted.__consumed = 0;
    window.DecompressionStream = class {
      readable: ReadableStream<Uint8Array>;
      writable: WritableStream<BufferSource>;
      constructor(format: CompressionFormat) {
        const real = new Real(format);
        const counter = new TransformStream<BufferSource, BufferSource>({
          transform(chunk, controller) {
            counted.__consumed += chunk.byteLength;
            controller.enqueue(chunk);
          },
        });
        counter.readable.pipeTo(real.writable).catch(() => {});
        this.writable = counter.writable;
        this.readable = real.readable;
      }
    } as unknown as typeof DecompressionStream;
  });

  const bomb = deflateRawSync(new Uint8Array(64 * 1024 * 1024));
  await page.goto(`${VIEWER}#v1.${bomb.toString("base64url")}`);
  await expect(page.locator(".preview-notice")).toBeVisible();
  const consumed = await page.evaluate(
    () => (window as unknown as { __consumed: number }).__consumed,
  );
  expect(consumed).toBeLessThan(bomb.length / 2);
});
