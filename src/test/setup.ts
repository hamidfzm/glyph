import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";
// Initialise the shared i18next instance so components using useTranslation /
// Trans render their English strings synchronously in tests.
import "@/lib/i18n";

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

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
  ask: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
  revealItemInDir: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(() =>
    Promise.resolve({
      get: vi.fn(() => Promise.resolve(null)),
      set: vi.fn(() => Promise.resolve()),
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
