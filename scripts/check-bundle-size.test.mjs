import { describe, expect, it } from "vitest";
import { evaluateBudgets, kb, markdownTable, startupAssets } from "./check-bundle-size.mjs";

const HTML = `<!doctype html><html><head>
<script>/* inline theme bootstrap has no src and is not an asset */</script>
<script type="module" crossorigin src="/assets/index-BmciaJVA.js"></script>
<link rel="stylesheet" crossorigin href="/assets/index-CduMu0bs.css">
<link rel="modulepreload" crossorigin href="/assets/vendor-abc.js">
<link rel="icon" href="/favicon.png" />
</head><body></body></html>`;

describe("startupAssets", () => {
  it("collects entry scripts, stylesheets, and modulepreloads without the leading slash", () => {
    expect(startupAssets(HTML)).toEqual([
      "assets/index-BmciaJVA.js",
      "assets/index-CduMu0bs.css",
      "assets/vendor-abc.js",
    ]);
  });

  it("ignores inline scripts and icons", () => {
    expect(startupAssets(HTML)).not.toContain("favicon.png");
  });
});

// Sizes keyed by file path; gzip modeled as half the raw size.
function sizerFor(sizes) {
  return (f) => {
    if (!(f in sizes)) throw new Error(`unexpected file measured: ${f}`);
    return { raw: sizes[f], gzip: sizes[f] / 2 };
  };
}

const budgets = {
  startup: 100,
  chunks: {
    d2: { prefix: "d2-", budgetGzip: 500 },
    pdf: { prefix: "pdfEngine-", budgetGzip: 50 },
  },
  unbudgetedChunkGzipLimit: 40,
};

describe("evaluateBudgets", () => {
  it("passes when every group is at or under budget", () => {
    const { rows, failures } = evaluateBudgets({
      startupFiles: ["assets/index-a.js"],
      assetFiles: ["assets/index-a.js", "assets/d2-x.js", "assets/pdfEngine-x.js"],
      budgets,
      sizeOf: sizerFor({ "assets/index-a.js": 200, "assets/d2-x.js": 1000, "assets/pdfEngine-x.js": 100 }),
    });
    expect(failures).toEqual([]);
    expect(rows.map((r) => r.name)).toEqual(["startup", "d2", "pdf"]);
    expect(rows[0]).toMatchObject({ raw: 200, gzip: 100, over: false });
  });

  it("fails a group whose gzip total exceeds its budget", () => {
    const { rows, failures } = evaluateBudgets({
      startupFiles: ["assets/index-a.js"],
      assetFiles: ["assets/index-a.js", "assets/d2-x.js", "assets/pdfEngine-x.js"],
      budgets,
      sizeOf: sizerFor({ "assets/index-a.js": 300, "assets/d2-x.js": 1000, "assets/pdfEngine-x.js": 100 }),
    });
    expect(rows[0].over).toBe(true);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("startup");
  });

  it("sums multiple files matching one prefix", () => {
    const { rows } = evaluateBudgets({
      startupFiles: [],
      assetFiles: ["assets/d2-x.js", "assets/d2-y.js", "assets/pdfEngine-x.js"],
      budgets,
      sizeOf: sizerFor({ "assets/d2-x.js": 400, "assets/d2-y.js": 600, "assets/pdfEngine-x.js": 100 }),
    });
    const d2 = rows.find((r) => r.name === "d2");
    expect(d2).toMatchObject({ files: 2, raw: 1000, gzip: 500, over: false });
  });

  it("fails when a budgeted prefix matches no file", () => {
    const { failures } = evaluateBudgets({
      startupFiles: [],
      assetFiles: ["assets/d2-x.js"],
      budgets,
      sizeOf: sizerFor({ "assets/d2-x.js": 400 }),
    });
    expect(failures.some((f) => f.includes('prefix "pdfEngine-"'))).toBe(true);
  });

  it("fails an unbudgeted asset above the limit and allows one below it", () => {
    const { failures } = evaluateBudgets({
      startupFiles: [],
      assetFiles: [
        "assets/d2-x.js",
        "assets/pdfEngine-x.js",
        "assets/huge-new.js",
        "assets/small-new.js",
        "assets/huge-style.css",
        "assets/small-font.woff2",
      ],
      budgets,
      sizeOf: sizerFor({
        "assets/d2-x.js": 400,
        "assets/pdfEngine-x.js": 100,
        "assets/huge-new.js": 100,
        "assets/small-new.js": 60,
        "assets/huge-style.css": 100,
        "assets/small-font.woff2": 60,
      }),
    });
    expect(failures.some((f) => f.includes("huge-new.js"))).toBe(true);
    expect(failures.some((f) => f.includes("huge-style.css"))).toBe(true);
    expect(failures.some((f) => f.includes("small-new.js"))).toBe(false);
    expect(failures.some((f) => f.includes("small-font.woff2"))).toBe(false);
  });

  it("fails when index.html yields no startup assets", () => {
    const { failures } = evaluateBudgets({
      startupFiles: [],
      assetFiles: ["assets/d2-x.js", "assets/pdfEngine-x.js"],
      budgets,
      sizeOf: sizerFor({ "assets/d2-x.js": 100, "assets/pdfEngine-x.js": 50 }),
    });
    expect(failures.some((f) => f.includes("no assets found in dist/index.html"))).toBe(true);
  });
});

describe("markdownTable", () => {
  it("renders a row per group with OVER marking", () => {
    const table = markdownTable([
      { name: "startup", files: 2, raw: 2048, gzip: 1024, budgetGzip: 512, over: true },
      { name: "d2", files: 1, raw: 1024, gzip: 512, budgetGzip: null, over: false },
    ]);
    expect(table).toContain("| startup | 2 | 2.0 kB | 1.0 kB | 0.5 kB | OVER |");
    expect(table).toContain("| d2 | 1 | 1.0 kB | 0.5 kB |  | ok |");
  });
});

describe("kb", () => {
  it("formats bytes as kB with one decimal", () => {
    expect(kb(1536)).toBe("1.5 kB");
  });
});
