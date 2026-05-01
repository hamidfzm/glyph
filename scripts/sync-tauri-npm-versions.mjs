#!/usr/bin/env node
/**
 * Keeps @tauri-apps/plugin-* versions in package.json aligned with resolved
 * tauri-plugin-* versions from Cargo (Tauri requires matching major.minor for `tauri build`).
 *
 * Usage:
 *   node scripts/sync-tauri-npm-versions.mjs           # pin package.json to Cargo + refresh lockfile
 *   node scripts/sync-tauri-npm-versions.mjs --check   # exit 1 if major.minor diverges
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const manifestPath = join(root, "src-tauri", "Cargo.toml");
const packagePath = join(root, "package.json");
const lockPath = join(root, "pnpm-lock.yaml");

const checkOnly = process.argv.includes("--check");

function rustPluginToNpmName(rustName) {
	if (!rustName.startsWith("tauri-plugin-")) {
		return null;
	}
	const rest = rustName.slice("tauri-plugin-".length);
	return `@tauri-apps/plugin-${rest}`;
}

/** @param {string} v */
function majorMinor(v) {
	const m = /^(\d+)\.(\d+)/.exec(v);
	if (!m) {
		throw new Error(`Invalid semver: ${v}`);
	}
	return `${m[1]}.${m[2]}`;
}

/**
 * Resolved versions from importers..dependencies in pnpm-lock.yaml
 * @returns {Record<string, string>}
 */
function getPnpmResolvedPluginVersions() {
	const text = readFileSync(lockPath, "utf8");
	const start = text.indexOf("\n  .:");
	if (start === -1) {
		throw new Error("pnpm-lock.yaml: missing importers '.'");
	}
	const sub = text.slice(start);
	const depStart = sub.indexOf("dependencies:");
	if (depStart === -1) {
		throw new Error("pnpm-lock.yaml: missing dependencies under importer");
	}
	const afterDeps = sub.slice(depStart);
	const devStart = afterDeps.search(/\n {4}devDependencies:/);
	const depBlock = devStart === -1 ? afterDeps : afterDeps.slice(0, devStart);
	const map = {};
	const re = / {6}['"](@tauri-apps\/plugin-[^'"]+)['"]:\s*\n {8}specifier:[^\n]+\n {8}version:\s+([0-9]+(?:\.[0-9]+)*)/g;
	let m;
	while ((m = re.exec(depBlock))) {
		map[m[1]] = m[2];
	}
	return map;
}

function getResolvedRustPluginVersions() {
	const json = execFileSync(
		"cargo",
		["metadata", "--format-version", "1", "--locked", "--manifest-path", manifestPath],
		{ encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
	);
	const meta = JSON.parse(json);
	const rootId = meta.resolve?.root;
	if (!rootId) {
		throw new Error("cargo metadata: missing resolve.root (need full metadata, not --no-deps)");
	}
	const rootNode = meta.resolve.nodes.find((n) => n.id === rootId);
	if (!rootNode) {
		throw new Error(`cargo metadata: could not find resolve node for ${rootId}`);
	}
	const byId = new Map(meta.packages.map((p) => [p.id, p]));
	const out = new Map();
	for (const dep of rootNode.deps) {
		const pkg = byId.get(dep.pkg);
		if (!pkg?.name?.startsWith("tauri-plugin-")) {
			continue;
		}
		out.set(pkg.name, pkg.version);
	}
	return out;
}

function main() {
	const rustVersions = getResolvedRustPluginVersions();
	const pnpmResolved = getPnpmResolvedPluginVersions();

	if (checkOnly) {
		const mismatches = [];
		for (const [rustName, rustVer] of rustVersions) {
			const npmName = rustPluginToNpmName(rustName);
			if (!npmName) {
				continue;
			}
			const npmResolved = pnpmResolved[npmName];
			if (!npmResolved) {
				mismatches.push(`${npmName}: missing from pnpm-lock.yaml (add to package.json dependencies)`);
				continue;
			}
			if (majorMinor(rustVer) !== majorMinor(npmResolved)) {
				mismatches.push(
					`${npmName}: Cargo resolves tauri ${rustVer} (major.minor ${majorMinor(rustVer)}), pnpm has ${npmResolved} (${majorMinor(npmResolved)})`,
				);
			}
		}
		if (mismatches.length > 0) {
			console.error(
				["Tauri plugin major.minor mismatch (breaks `tauri build`):", ...mismatches.map((l) => `  ${l}`), "", "Fix: pnpm sync:tauri-npm"].join("\n"),
			);
			process.exit(1);
		}
		console.log("Tauri Rust/npm plugin major.minor alignment OK.");
		return;
	}

	const pkgRaw = readFileSync(packagePath, "utf8");
	const pkg = JSON.parse(pkgRaw);
	const deps = pkg.dependencies;
	if (!deps || typeof deps !== "object") {
		throw new Error("package.json: missing dependencies");
	}

	let changed = false;
	for (const [rustName, version] of rustVersions) {
		const npmName = rustPluginToNpmName(rustName);
		if (!npmName || !(npmName in deps)) {
			continue;
		}
		const current = String(deps[npmName]);
		const normalized = current.replace(/^[\^~]/, "");
		if (normalized !== version) {
			deps[npmName] = version;
			changed = true;
		}
	}

	if (changed) {
		writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
		execFileSync("pnpm", ["install"], { cwd: root, stdio: "inherit" });
		console.log("Updated package.json and lockfile from Cargo resolved versions.");
	} else {
		console.log("Already aligned; no changes.");
	}
}

main();
