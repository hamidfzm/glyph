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
    renderHook(() => useLocale("de"));
    await waitFor(() => expect(i18n.language).toBe("de"));
    expect(document.documentElement.lang).toBe("de");
    expect(document.documentElement.dir).toBe("ltr");
    expect(mockOsLocale).not.toHaveBeenCalled();
  });

  it("follows the OS locale when set to system", async () => {
    mockOsLocale.mockResolvedValue("de-DE");
    renderHook(() => useLocale("system"));
    await waitFor(() => expect(i18n.language).toBe("de"));
    expect(document.documentElement.lang).toBe("de");
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
});
