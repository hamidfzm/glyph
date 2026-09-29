import { describe, expect, it, vi } from "vitest";
import { connectHost } from "./previewHost";

describe("connectHost", () => {
  it("uses WebView2's host inside the Windows preview handler", () => {
    const webview = { addEventListener: vi.fn() };
    const win = { chrome: { webview } } as unknown as Window;

    expect(connectHost(win)).toEqual({ host: webview, platform: "windows" });
    expect("glyphHost" in win).toBe(false);
  });

  it("exposes glyphHost for the Quick Look extension to post to", () => {
    const win = {} as Window & { glyphHost?: { post(data: unknown): void } };
    const { host, platform } = connectHost(win);
    const listener = vi.fn();
    host.addEventListener("message", listener);

    win.glyphHost?.post({ kind: "unreadable" });

    expect(platform).toBe("macos");
    expect(listener).toHaveBeenCalledWith({ data: { kind: "unreadable" } });
  });

  it("delivers what the host posted before the page script ran", () => {
    const win = { glyphHost: { messages: [{ kind: "unreadable" }] } } as unknown as Window & {
      glyphHost?: { post(data: unknown): void };
    };
    const { host } = connectHost(win);
    const listener = vi.fn();
    host.addEventListener("message", listener);
    win.glyphHost?.post("later");

    expect(listener.mock.calls).toEqual([[{ data: { kind: "unreadable" } }], [{ data: "later" }]]);
  });

  it("delivers every post to every listener", () => {
    const win = {} as Window & { glyphHost?: { post(data: unknown): void } };
    const { host } = connectHost(win);
    const first = vi.fn();
    const second = vi.fn();
    host.addEventListener("message", first);
    host.addEventListener("message", second);

    win.glyphHost?.post("a");
    win.glyphHost?.post("b");

    expect(first.mock.calls).toEqual([[{ data: "a" }], [{ data: "b" }]]);
    expect(second.mock.calls).toEqual([[{ data: "a" }], [{ data: "b" }]]);
  });
});
