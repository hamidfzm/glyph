import type { Breadcrumb, ErrorEvent } from "@sentry/react";
import * as Sentry from "@sentry/react";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  disableTelemetry,
  enableTelemetry,
  redactPaths,
  scrubBreadcrumb,
  scrubEvent,
} from "./telemetry";

vi.mock("@sentry/react", () => ({
  init: vi.fn(),
  getClient: vi.fn(() => undefined),
}));

const mockedInvoke = vi.mocked(invoke);
const mockedInit = vi.mocked(Sentry.init);
const mockedGetClient = vi.mocked(Sentry.getClient);

beforeEach(() => {
  vi.clearAllMocks();
  mockedInvoke.mockResolvedValue(undefined);
  mockedGetClient.mockReturnValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("redactPaths", () => {
  it("redacts Windows absolute paths", () => {
    expect(redactPaths(String.raw`opened C:\Users\Jane\Secret\notes.md ok`)).toBe(
      "opened [redacted-path] ok",
    );
  });

  it("redacts POSIX home paths", () => {
    expect(redactPaths("read /Users/jane/Documents/diary.md failed")).toBe(
      "read [redacted-path] failed",
    );
    expect(redactPaths("at /home/jane/notes/todo.md")).toBe("at [redacted-path]");
  });

  it("redacts file:// URLs", () => {
    expect(redactPaths("file:///Users/jane/x.md broke")).toBe("[redacted-path] broke");
  });

  it("leaves path-free text untouched", () => {
    expect(redactPaths("Cannot read property of undefined")).toBe(
      "Cannot read property of undefined",
    );
  });
});

describe("scrubBreadcrumb", () => {
  it("drops navigation / fetch / xhr breadcrumbs", () => {
    expect(scrubBreadcrumb({ category: "navigation" })).toBeNull();
    expect(scrubBreadcrumb({ category: "fetch" })).toBeNull();
    expect(scrubBreadcrumb({ category: "xhr" })).toBeNull();
  });

  it("redacts paths in the message and url data", () => {
    const result = scrubBreadcrumb({
      category: "ui.click",
      message: "opened /Users/jane/a.md",
      data: { url: "https://example.com/secret" },
    });
    expect(result).not.toBeNull();
    expect(result?.message).toBe("opened [redacted-path]");
    expect(result?.data?.url).toBe("[redacted-url]");
  });

  it("keeps a plain breadcrumb as-is", () => {
    const crumb: Breadcrumb = { category: "ui.click", message: "clicked button" };
    expect(scrubBreadcrumb(crumb)).toEqual(crumb);
  });

  it("keeps a breadcrumb that has no message", () => {
    const crumb: Breadcrumb = { category: "ui.click" };
    expect(scrubBreadcrumb(crumb)).toEqual({ category: "ui.click" });
  });

  it("leaves non-string url data untouched", () => {
    const crumb: Breadcrumb = { category: "ui.click", data: { count: 3 } };
    expect(scrubBreadcrumb(crumb)?.data).toEqual({ count: 3 });
  });
});

describe("scrubEvent", () => {
  it("strips request, user, and server_name", () => {
    const event = {
      request: { url: "https://x" },
      user: { ip_address: "1.2.3.4" },
      server_name: "janes-macbook",
    } as unknown as ErrorEvent;

    const scrubbed = scrubEvent(event);
    expect(scrubbed.request).toBeUndefined();
    expect(scrubbed.user).toBeUndefined();
    expect(scrubbed.server_name).toBeUndefined();
  });

  it("redacts the message and exception values", () => {
    const event = {
      message: "failed at /Users/jane/a.md",
      exception: { values: [{ value: String.raw`ENOENT C:\Users\Jane\b.md` }] },
    } as unknown as ErrorEvent;

    const scrubbed = scrubEvent(event);
    expect(scrubbed.message).toBe("failed at [redacted-path]");
    expect(scrubbed.exception?.values?.[0].value).toBe("ENOENT [redacted-path]");
  });

  it("handles exceptions that have no value", () => {
    const event = {
      exception: { values: [{ type: "Error" }] },
    } as unknown as ErrorEvent;

    const scrubbed = scrubEvent(event);
    expect(scrubbed.exception?.values?.[0].value).toBeUndefined();
  });

  it("keeps only allowlisted contexts", () => {
    const event = {
      contexts: {
        os: { name: "macOS" },
        app: { app_version: "1.0" },
        evil: { secret: "leak" },
      },
    } as unknown as ErrorEvent;

    const scrubbed = scrubEvent(event);
    expect(scrubbed.contexts?.os).toBeDefined();
    expect(scrubbed.contexts?.app).toBeDefined();
    expect(scrubbed.contexts?.evil).toBeUndefined();
  });

  it("filters URL-bearing breadcrumbs and redacts the rest", () => {
    const event = {
      breadcrumbs: [
        { category: "navigation", message: "/Users/jane" },
        { category: "ui.click", message: "open /Users/jane/a.md" },
      ],
    } as unknown as ErrorEvent;

    const scrubbed = scrubEvent(event);
    expect(scrubbed.breadcrumbs).toHaveLength(1);
    expect(scrubbed.breadcrumbs?.[0].message).toBe("open [redacted-path]");
  });
});

describe("enableTelemetry", () => {
  it("mirrors state to the backend but does not init Sentry in dev", () => {
    vi.stubEnv("PROD", false);
    enableTelemetry();
    expect(mockedInvoke).toHaveBeenCalledWith("set_error_reporting", { enabled: true });
    expect(mockedInit).not.toHaveBeenCalled();
  });

  it("initializes Sentry in production when no client exists", () => {
    vi.stubEnv("PROD", true);
    enableTelemetry();
    expect(mockedInit).toHaveBeenCalledTimes(1);
    const options = mockedInit.mock.calls[0][0];
    expect(options).toMatchObject({ sendDefaultPii: false, tracesSampleRate: 0 });
    expect(options?.beforeSend).toBe(scrubEvent);
    expect(options?.beforeBreadcrumb).toBe(scrubBreadcrumb);
  });

  it("does not re-init when a client already exists", () => {
    vi.stubEnv("PROD", true);
    mockedGetClient.mockReturnValue({} as ReturnType<typeof Sentry.getClient>);
    enableTelemetry();
    expect(mockedInit).not.toHaveBeenCalled();
  });
});

describe("disableTelemetry", () => {
  it("mirrors state to the backend and closes an existing client", () => {
    const close = vi.fn();
    mockedGetClient.mockReturnValue({ close } as unknown as ReturnType<typeof Sentry.getClient>);
    disableTelemetry();
    expect(mockedInvoke).toHaveBeenCalledWith("set_error_reporting", { enabled: false });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("is a no-op on the client when none exists", () => {
    mockedGetClient.mockReturnValue(undefined);
    expect(() => disableTelemetry()).not.toThrow();
  });
});
