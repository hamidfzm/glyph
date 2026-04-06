import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${path}`),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(vi.fn())),
  emit: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-os", () => ({
  platform: vi.fn(() => "macos"),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  ask: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(() =>
    Promise.resolve({
      get: vi.fn(() => Promise.resolve(null)),
      set: vi.fn(() => Promise.resolve()),
    }),
  ),
}));

vi.mock("@tauri-apps/api/menu", () => ({
  Menu: { new: vi.fn() },
  MenuItem: { new: vi.fn() },
  PredefinedMenuItem: { new: vi.fn() },
  Submenu: { new: vi.fn() },
}));
