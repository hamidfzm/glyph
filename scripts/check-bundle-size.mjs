// Bundle size gate: records raw + gzip sizes for the startup assets and the
// major lazy chunks, and fails when a gzip budget in bundle-budgets.json is
// exceeded. Budgets and the process for updating them are documented in
// docs/bundle-budgets.md.
//
// Usage: node scripts/check-bundle-size.mjs [distDir]
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

/** Asset paths referenced from index.html: the startup download set. */
export function startupAssets(html) {
  const refs = [];
  for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) refs.push(m[1]);
  for (const m of html.matchAll(/<link[^>]+rel="(?:stylesheet|modulepreload)"[^>]+href="([^"]+)"/g))
    refs.push(m[1]);
  return refs.map((r) => r.replace(/^\//, ""));
}

/** Group dist files into budget groups. Returns rows + hard failures. */
export function evaluateBudgets({ startupFiles, assetFiles, budgets, sizeOf }) {
  const rows = [];
  const failures = [];
  const claimed = new Set();

  const measure = (name, files, budgetGzip) => {
    let raw = 0;
    let gzip = 0;
    for (const f of files) {
      const s = sizeOf(f);
      raw += s.raw;
      gzip += s.gzip;
    }
    const over = budgetGzip != null && gzip > budgetGzip;
    rows.push({ name, files: files.length, raw, gzip, budgetGzip, over });
    if (over) {
      failures.push(
        `${name}: ${kb(gzip)} gzip exceeds the ${kb(budgetGzip)} budget. ` +
          `If the growth is intentional, update bundle-budgets.json and docs/bundle-budgets.md.`,
      );
    }
  };

  // An empty startup set means index.html parsing broke (attribute order,
  // quoting); it must fail loudly, not pass a 0-byte budget forever.
  if (startupFiles.length === 0) {
    failures.push(
      "startup: no assets found in dist/index.html. " +
        "The startupAssets() regexes no longer match Vite's output; fix scripts/check-bundle-size.mjs.",
    );
  }
  measure("startup", startupFiles, budgets.startup);
  for (const [name, entry] of Object.entries(budgets.chunks)) {
    const files = assetFiles.filter((f) => path.basename(f).startsWith(entry.prefix));
    for (const f of files) claimed.add(f);
    if (files.length === 0) {
      failures.push(
        `${name}: no dist/assets file matches prefix "${entry.prefix}". ` +
          `The chunk was renamed or removed; update bundle-budgets.json to match.`,
      );
      continue;
    }
    measure(name, files, entry.budgetGzip);
  }

  // A new heavyweight asset without a budget must not slip in unnoticed.
  for (const f of assetFiles) {
    if (claimed.has(f) || startupFiles.includes(f)) continue;
    const { gzip } = sizeOf(f);
    if (gzip > budgets.unbudgetedChunkGzipLimit) {
      failures.push(
        `${path.basename(f)}: ${kb(gzip)} gzip has no budget entry ` +
          `(limit for unbudgeted chunks is ${kb(budgets.unbudgetedChunkGzipLimit)}). ` +
          `Give it a stable name and a budget in bundle-budgets.json.`,
      );
    }
  }

  return { rows, failures };
}

export function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} kB`;
}

export function markdownTable(rows) {
  const lines = [
    "| Group | Files | Raw | Gzip | Budget (gzip) | Status |",
    "|---|---:|---:|---:|---:|---|",
  ];
  for (const r of rows) {
    const budget = r.budgetGzip == null ? "" : kb(r.budgetGzip);
    lines.push(
      `| ${r.name} | ${r.files} | ${kb(r.raw)} | ${kb(r.gzip)} | ${budget} | ${r.over ? "OVER" : "ok"} |`,
    );
  }
  return lines.join("\n");
}

function main() {
  const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
  const distDir = path.resolve(process.argv[2] ?? path.join(root, "dist"));
  if (!existsSync(path.join(distDir, "index.html"))) {
    console.error(`No build found at ${distDir}. Run \`pnpm build\` first.`);
    process.exit(1);
  }
  const budgets = JSON.parse(readFileSync(path.join(root, "bundle-budgets.json"), "utf8"));
  const html = readFileSync(path.join(distDir, "index.html"), "utf8");

  const startupFiles = startupAssets(html);
  // Forward-slash relative paths so they compare equal to index.html refs on
  // Windows. Sourcemaps never ship to users, so they are not measured.
  const assetFiles = readdirSync(path.join(distDir, "assets"))
    .filter((f) => !f.endsWith(".map"))
    .map((f) => `assets/${f}`);
  const sizeOf = (rel) => {
    const abs = path.join(distDir, rel);
    const raw = statSync(abs).size;
    const gzip = gzipSync(readFileSync(abs), { level: 9 }).length;
    return { raw, gzip };
  };

  const { rows, failures } = evaluateBudgets({ startupFiles, assetFiles, budgets, sizeOf });
  const table = markdownTable(rows);
  console.log(table);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Bundle sizes\n\n${table}\n`);
  }
  if (failures.length > 0) {
    for (const f of failures) console.error(`ERROR: ${f}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
