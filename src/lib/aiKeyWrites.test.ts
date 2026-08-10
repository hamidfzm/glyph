import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cancelAiKeyWrite, scheduleAiKeyWrite } from "@/lib/aiKeyWrites";

const { setAiKeyMock } = vi.hoisted(() => ({ setAiKeyMock: vi.fn() }));
vi.mock("@/lib/aiKeys", () => ({ setAiKey: setAiKeyMock }));

beforeEach(() => {
  vi.useFakeTimers();
  setAiKeyMock.mockReset();
  setAiKeyMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("aiKeyWrites", () => {
  it("debounces the keychain write and reports success", async () => {
    const onSettled = vi.fn();
    scheduleAiKeyWrite("claude", "sk-ant-1", onSettled);
    expect(setAiKeyMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(600);
    expect(setAiKeyMock).toHaveBeenCalledExactlyOnceWith("claude", "sk-ant-1");
    expect(onSettled).toHaveBeenCalledWith(null);
  });

  it("keeps only the last queued value for a provider", async () => {
    const onSettled = vi.fn();
    scheduleAiKeyWrite("claude", "sk-a", onSettled);
    await vi.advanceTimersByTimeAsync(300);
    scheduleAiKeyWrite("claude", "sk-ab", onSettled);

    await vi.advanceTimersByTimeAsync(600);
    expect(setAiKeyMock).toHaveBeenCalledExactlyOnceWith("claude", "sk-ab");
  });

  it("passes the rejection reason to the caller", async () => {
    const failure = new Error("keyring locked");
    setAiKeyMock.mockRejectedValue(failure);
    const onSettled = vi.fn();

    scheduleAiKeyWrite("openai", "sk-x", onSettled);
    await vi.advanceTimersByTimeAsync(600);
    expect(onSettled).toHaveBeenCalledWith(failure);
  });

  it("drops a queued write so a later removal is not undone by it", async () => {
    scheduleAiKeyWrite("claude", "sk-typed", vi.fn());
    cancelAiKeyWrite("claude");

    await vi.advanceTimersByTimeAsync(600);
    expect(setAiKeyMock).not.toHaveBeenCalled();
  });

  it("cancels per provider, leaving another provider's write queued", async () => {
    scheduleAiKeyWrite("claude", "sk-ant", vi.fn());
    scheduleAiKeyWrite("openai", "sk-oai", vi.fn());
    cancelAiKeyWrite("claude");

    await vi.advanceTimersByTimeAsync(600);
    expect(setAiKeyMock).toHaveBeenCalledExactlyOnceWith("openai", "sk-oai");
  });

  it("cancelling with nothing queued is a no-op", async () => {
    cancelAiKeyWrite("claude");
    await vi.advanceTimersByTimeAsync(600);
    expect(setAiKeyMock).not.toHaveBeenCalled();
  });
});
