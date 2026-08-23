import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// tauri-driver proxies the W3C WebDriver protocol to the platform's native
// driver (WebKitWebDriver on Linux, msedgedriver on Windows), which launches
// the binary itself. Three endpoints are all the smoke needs, so this is a raw
// client over fetch rather than a WebDriver library.
const DRIVER_URL = "http://127.0.0.1:4444";
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/** `GLYPH_BIN`, else the release build. Release-only: the single-instance plugin is release-gated (lib.rs). */
export function resolveBinary(): string {
  const exe = process.platform === "win32" ? ".exe" : "";
  const candidates = [
    process.env.GLYPH_BIN,
    path.join(REPO_ROOT, "src-tauri", "target", "release", `glyph${exe}`),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      `No Glyph release binary found; run \`pnpm tauri build --no-bundle\` or set GLYPH_BIN. Looked in:\n${candidates.join("\n")}`,
    );
  }
  return found;
}

/** Poll `probe` until it resolves truthy; throws with the last result on timeout. */
export async function waitFor<T>(
  what: string,
  probe: () => Promise<T>,
  timeoutMs = 30_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value) return value;
      last = value;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for ${what}; last result: ${String(last)}`,
  );
}

/** Spawn `tauri-driver` (from PATH) and wait until it accepts connections. */
export async function startDriver(): Promise<ChildProcess> {
  const driver = spawn("tauri-driver", [], { stdio: ["ignore", "inherit", "inherit"] });
  // tauri-driver exits immediately when its native driver is missing or the
  // ports are busy; surface that instead of a 15s "fetch failed" timeout.
  const driverStopped = new Promise<never>((_, reject) => {
    driver.once("error", (error) =>
      reject(
        new Error(
          `Could not start tauri-driver (cargo install tauri-driver --locked): ${error.message}`,
        ),
      ),
    );
    driver.once("exit", (code, signal) =>
      reject(
        new Error(
          `tauri-driver exited (${code ?? signal}) before listening; is WebKitWebDriver/msedgedriver installed and are ports 4444/4445 free?`,
        ),
      ),
    );
  });
  await Promise.race([
    driverStopped,
    waitFor(
      "tauri-driver to listen",
      () => fetch(`${DRIVER_URL}/status`).then((res) => res.ok),
      15_000,
    ),
  ]);
  return driver;
}

async function request<T>(method: string, route: string, body?: unknown): Promise<T> {
  const response = await fetch(`${DRIVER_URL}${route}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let value: unknown = text;
  try {
    value = JSON.parse(text).value;
  } catch {
    // Non-JSON error body (e.g. a driver stack trace); keep the raw text.
  }
  if (!response.ok) {
    const detail = typeof value === "string" ? value : JSON.stringify(value);
    throw new Error(`${method} ${route} -> ${response.status}: ${detail}`);
  }
  return value as T;
}

/** Launch `application` with `args` through the driver; resolves to the session id. */
export async function newSession(application: string, args: string[]): Promise<string> {
  const { sessionId } = await request<{ sessionId: string }>("POST", "/session", {
    capabilities: { alwaysMatch: { "tauri:options": { application, args } } },
  });
  return sessionId;
}

/** Run `script` (a function body; use `return`) in the app's webview. */
export function execute<T>(sessionId: string, script: string): Promise<T> {
  return request<T>("POST", `/session/${sessionId}/execute/sync`, { script, args: [] });
}

/** Close the session, which also quits the app the driver launched. */
export function deleteSession(sessionId: string): Promise<void> {
  return request<void>("DELETE", `/session/${sessionId}`);
}
