import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";
// Initialise the shared i18next instance so components using useTranslation /
// Trans render their English strings synchronously in tests.
import "@/lib/i18n";
import { installConsoleGuard } from "@/test/consoleGuard";

installConsoleGuard();

vi.mock("@tauri-apps/api/core", () => ({
  // Mirrors the real API: invoke always returns a Promise. Tests that need a
  // specific resolved/rejected value override per-case with mockResolvedValue.
  invoke: vi.fn(() => Promise.resolve()),
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${path}`),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(vi.fn())),
  emit: vi.fn(),
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(() => Promise.resolve("0.0.0")),
  setTheme: vi.fn(() => Promise.resolve()),
}));

// Default network stub so the on-launch update check (and any other fetch) never
// hits the real network in tests. Resolves to a non-ok response, which the
// update check treats as "no update". Tests that exercise fetch directly
// reassign globalThis.fetch themselves.
globalThis.fetch = vi.fn(() =>
  Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as Response),
) as unknown as typeof fetch;

vi.mock("@tauri-apps/plugin-os", () => ({
  platform: vi.fn(() => "macos"),
  locale: vi.fn(() => Promise.resolve("en-US")),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(() => Promise.resolve("")),
}));

// The Rust-side fetch, used for marketplace package downloads because GitHub
// release assets carry no CORS headers. It delegates to whatever `fetch` the
// test stubbed, so a suite that already routes by URL covers both legs; a test
// that cares which transport was used stubs this module directly.
vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: vi.fn((...args: Parameters<typeof fetch>) => globalThis.fetch(...args)),
}));

// open/save moved to the backend pickers in src/lib/pickers.ts;
// `open` remains the mobile document picker (see pickFiles).
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: vi.fn(() => Promise.resolve(true)),
  open: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
  revealItemInDir: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-store", () => ({
  getStore: vi.fn(() =>
    Promise.resolve({
      get: vi.fn(() => Promise.resolve(null)),
      set: vi.fn(() => Promise.resolve()),
      save: vi.fn(() => Promise.resolve()),
      entries: vi.fn(() => Promise.resolve([])),
      delete: vi.fn(() => Promise.resolve(true)),
      length: vi.fn(() => Promise.resolve(0)),
    }),
  ),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    show: vi.fn(() => Promise.resolve()),
    setFocus: vi.fn(() => Promise.resolve()),
    // Returns an unlisten fn, like the real API; the close guard registers here.
    onCloseRequested: vi.fn(() => Promise.resolve(() => {})),
    close: vi.fn(() => Promise.resolve()),
  }),
}));
