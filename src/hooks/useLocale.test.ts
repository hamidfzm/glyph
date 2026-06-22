import { locale as osLocale } from "@tauri-apps/plugin-os";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/lib/i18n";
import { useLocale } from "./useLocale";

const mockOsLocale = vi.mocked(osLocale);

describe("useLocale", () => {
  beforeEach(async () => {
    document.documentElement.lang = "";
    document.documentElement.dir = "";
    mockOsLocale.mockReset();
    await i18n.changeLanguage("en");
  });

  it("applies an explicit override without consulting the OS", async () => {
    renderHook(() => useLocale("en"));
    await waitFor(() => expect(document.documentElement.lang).toBe("en"));
    expect(document.documentElement.dir).toBe("ltr");
    expect(mockOsLocale).not.toHaveBeenCalled();
  });

  it("sets dir=rtl for a right-to-left locale", async () => {
    renderHook(() => useLocale("fa"));
    await waitFor(() => expect(i18n.language).toBe("fa"));
    expect(document.documentElement.lang).toBe("fa");
    expect(document.documentElement.dir).toBe("rtl");
  });

  it("consults the OS locale when set to system", async () => {
    mockOsLocale.mockResolvedValue("en-GB");
    renderHook(() => useLocale("system"));
    await waitFor(() => expect(mockOsLocale).toHaveBeenCalled());
    expect(document.documentElement.lang).toBe("en");
  });

  it("resolves an unsupported OS locale to English", async () => {
    mockOsLocale.mockResolvedValue("fr-FR");
    renderHook(() => useLocale("system"));
    await waitFor(() => expect(i18n.language).toBe("en"));
    expect(document.documentElement.lang).toBe("en");
  });

  it("falls back to English when the OS locale lookup throws", async () => {
    mockOsLocale.mockRejectedValue(new Error("unavailable"));
    renderHook(() => useLocale("system"));
    await waitFor(() => expect(i18n.language).toBe("en"));
  });

  it("uses the webview locale when the OS reports none", async () => {
    mockOsLocale.mockResolvedValue(null);
    renderHook(() => useLocale("system"));
    await waitFor(() => expect(mockOsLocale).toHaveBeenCalled());
    // navigator.language is en-US under happy-dom, so it resolves to English.
    expect(document.documentElement.lang).toBe("en");
  });

  it("does not apply the locale if unmounted before the OS lookup resolves", async () => {
    let resolveOs: (value: string) => void = () => {};
    mockOsLocale.mockReturnValue(new Promise<string>((r) => (resolveOs = r)));
    const { unmount } = renderHook(() => useLocale("system"));
    unmount();
    resolveOs("en-GB");
    await Promise.resolve();
    await Promise.resolve();
    expect(document.documentElement.lang).toBe("");
  });

  it("does not apply the locale if unmounted mid-change", async () => {
    const { unmount } = renderHook(() => useLocale("en"));
    unmount();
    await Promise.resolve();
    await Promise.resolve();
    expect(document.documentElement.lang).toBe("");
  });
});
