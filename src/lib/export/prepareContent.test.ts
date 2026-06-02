import { afterEach, describe, expect, it } from "vitest";
import type { TocEntry } from "@/hooks/useTableOfContents";
import { prepareContent } from "./prepareContent";

const ENTRIES: TocEntry[] = [{ id: "intro", text: "Intro", level: 1 }];

function setBody(html: string): void {
  const body = document.createElement("div");
  body.className = "markdown-body";
  body.innerHTML = html;
  document.body.appendChild(body);
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("prepareContent", () => {
  it("returns null when there is no rendered body", async () => {
    expect(await prepareContent({ entries: ENTRIES, includeToc: false })).toBeNull();
  });

  it("strips copy buttons and export-ignored elements", async () => {
    setBody(
      `<div class="code-block-wrapper"><button class="code-copy-button">copy</button><pre>code</pre></div>` +
        `<div data-export-ignore="true">hidden</div><p>keep</p>`,
    );
    const html = await prepareContent({ entries: ENTRIES, includeToc: false });
    expect(html).not.toContain("code-copy-button");
    expect(html).not.toContain("hidden");
    expect(html).toContain("<pre>code</pre>");
    expect(html).toContain("keep");
  });

  it("injects a table of contents when requested", async () => {
    setBody("<h1>Intro</h1>");
    const html = await prepareContent({ entries: ENTRIES, includeToc: true });
    expect(html).toContain('class="print-toc"');
    expect(html).toContain('href="#intro"');
  });

  it("omits the toc when includeToc is false", async () => {
    setBody("<h1>Intro</h1>");
    const html = await prepareContent({ entries: ENTRIES, includeToc: false });
    expect(html).not.toContain("print-toc");
  });

  it("leaves already-inlined data URIs untouched", async () => {
    setBody(`<img src="data:image/png;base64,AAAA" alt="x">`);
    const html = await prepareContent({ entries: ENTRIES, includeToc: false });
    expect(html).toContain("data:image/png;base64,AAAA");
  });
});
