import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scheduleAiKeyWrite, writeAiKeyNow } from "@/lib/aiKeyWrites";
import { deferred } from "@/test/deferred";

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
    expect(onSettled).toHaveBeenCalledWith(true);
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
    expect(onSettled).toHaveBeenCalledWith(false, failure);
  });

  it("drops a still-queued write in favour of an immediate one", async () => {
    scheduleAiKeyWrite("claude", "sk-typed", vi.fn());
    await writeAiKeyNow("claude", "");

    await vi.advanceTimersByTimeAsync(600);
    expect(setAiKeyMock).toHaveBeenCalledExactlyOnceWith("claude", "");
  });

  it("lands after a write that already left the debounce", async () => {
    // The keychain call is held open so the removal is issued while the
    // keystroke write is mid-flight, the window a cancel alone can't cover.
    const inFlight = deferred();
    setAiKeyMock.mockReturnValueOnce(inFlight.promise);
    scheduleAiKeyWrite("claude", "sk-typed", vi.fn());
    await vi.advanceTimersByTimeAsync(600);
    expect(setAiKeyMock).toHaveBeenCalledExactlyOnceWith("claude", "sk-typed");

    const removal = writeAiKeyNow("claude", "");
    expect(setAiKeyMock).toHaveBeenCalledTimes(1);

    inFlight.resolve();
    await removal;
    expect(setAiKeyMock).toHaveBeenLastCalledWith("claude", "");
  });

  it("does not wedge a provider after a failed write", async () => {
    setAiKeyMock.mockRejectedValueOnce(new Error("keyring locked"));
    await expect(writeAiKeyNow("claude", "sk-a")).rejects.toThrow("keyring locked");

    await writeAiKeyNow("claude", "sk-b");
    expect(setAiKeyMock).toHaveBeenLastCalledWith("claude", "sk-b");
  });

  it("serializes per provider, leaving another provider's write queued", async () => {
    scheduleAiKeyWrite("claude", "sk-ant", vi.fn());
    scheduleAiKeyWrite("openai", "sk-oai", vi.fn());
    await writeAiKeyNow("claude", "");

    await vi.advanceTimersByTimeAsync(600);
    expect(setAiKeyMock.mock.calls).toEqual([
      ["claude", ""],
      ["openai", "sk-oai"],
    ]);
  });
});
