import { getVersion } from "@tauri-apps/api/app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkForUpdate, RELEASES_PAGE } from "./updateCheck";

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(() => Promise.resolve("0.8.1")),
}));

function mockFetch(response: Partial<Response> & { jsonValue?: unknown }) {
  const fetchFn = vi.fn(() =>
    Promise.resolve({
      ok: response.ok ?? true,
      json: () => Promise.resolve(response.jsonValue ?? {}),
    } as Response),
  );
  globalThis.fetch = fetchFn as unknown as typeof fetch;
  return fetchFn;
}

beforeEach(() => {
  vi.mocked(getVersion).mockResolvedValue("0.8.1");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("checkForUpdate", () => {
  it("reports an available update when the release tag is newer", async () => {
    mockFetch({
      ok: true,
      jsonValue: { tag_name: "v0.9.0", html_url: "https://example.com/releases/0.9.0" },
    });

    const result = await checkForUpdate();
    expect(result).toEqual({
      status: "available",
      latestVersion: "0.9.0",
      currentVersion: "0.8.1",
      url: "https://example.com/releases/0.9.0",
    });
  });

  it("falls back to the releases page when html_url is missing", async () => {
    mockFetch({ ok: true, jsonValue: { tag_name: "0.9.0" } });

    const result = await checkForUpdate();
    expect(result).toMatchObject({ status: "available", url: RELEASES_PAGE });
  });

  it("reports current when the latest release is not newer", async () => {
    mockFetch({ ok: true, jsonValue: { tag_name: "v0.8.1" } });

    const result = await checkForUpdate();
    expect(result).toEqual({ status: "current", currentVersion: "0.8.1" });
  });

  it("reports error on a non-ok response", async () => {
    mockFetch({ ok: false });

    expect(await checkForUpdate()).toEqual({ status: "error" });
  });

  it("reports error on a malformed payload (missing tag_name)", async () => {
    mockFetch({ ok: true, jsonValue: { name: "no tag here" } });

    expect(await checkForUpdate()).toEqual({ status: "error" });
  });

  it("reports error when the request throws", async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error("offline"))) as unknown as typeof fetch;

    expect(await checkForUpdate()).toEqual({ status: "error" });
  });
});
