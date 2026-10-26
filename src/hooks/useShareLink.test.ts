import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { shareLinkFor } from "@/lib/shareLink";
import { type FileState, makeFileState } from "@/lib/tabs";
import { useShareLink } from "./useShareLink";

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));
vi.mock("@/lib/shareLink", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/shareLink")>()),
  shareLinkFor: vi.fn(),
}));

function file(overrides: Partial<FileState> = {}): FileState {
  return { ...makeFileState("/notes/readme.md", "view"), content: "# Saved", ...overrides };
}

function copyWith(active: FileState | null) {
  const showNotice = vi.fn();
  const { result } = renderHook(() => useShareLink({ file: active, showNotice }));
  return { copy: result.current, showNotice };
}

beforeEach(() => {
  vi.mocked(writeText).mockReset().mockResolvedValue(undefined);
  vi.mocked(shareLinkFor).mockReset();
});

describe("useShareLink", () => {
  it("copies a link to the text the tab shows, unsaved edits included", async () => {
    vi.mocked(shareLinkFor).mockResolvedValue("https://example.test/view/#v1.abc");
    const { copy, showNotice } = copyWith(file({ editContent: "# Edited", dirty: true }));

    copy();

    await vi.waitFor(() => expect(showNotice).toHaveBeenCalledWith({ kind: "linkCopied" }));
    expect(shareLinkFor).toHaveBeenCalledWith("# Edited");
    expect(writeText).toHaveBeenCalledWith("https://example.test/view/#v1.abc");
  });

  it("leaves the clipboard alone when the link would be too long", async () => {
    vi.mocked(shareLinkFor).mockResolvedValue(null);
    const { copy, showNotice } = copyWith(file());

    copy();

    await vi.waitFor(() => expect(showNotice).toHaveBeenCalledWith({ kind: "linkTooLong" }));
    expect(writeText).not.toHaveBeenCalled();
  });

  it("reports a clipboard write that fails", async () => {
    vi.mocked(shareLinkFor).mockResolvedValue("https://example.test/view/#v1.abc");
    vi.mocked(writeText).mockRejectedValue(new Error("clipboard unavailable"));
    const { copy, showNotice } = copyWith(file());

    copy();

    await vi.waitFor(() =>
      expect(showNotice).toHaveBeenCalledWith({
        kind: "linkFailed",
        reason: "clipboard unavailable",
      }),
    );
    expect(showNotice).toHaveBeenCalledOnce();
  });

  it("reports an encode that fails", async () => {
    vi.mocked(shareLinkFor).mockRejectedValue(new Error("no CompressionStream"));
    const { copy, showNotice } = copyWith(file());

    copy();

    await vi.waitFor(() =>
      expect(showNotice).toHaveBeenCalledWith({
        kind: "linkFailed",
        reason: "no CompressionStream",
      }),
    );
    expect(writeText).not.toHaveBeenCalled();
  });

  it("lets a later copy win over an earlier one still encoding", async () => {
    let finishFirst: (link: string) => void = () => {};
    vi.mocked(shareLinkFor)
      .mockImplementationOnce(() => new Promise((resolve) => (finishFirst = resolve)))
      .mockResolvedValueOnce("https://example.test/view/#v1.second");
    const { copy, showNotice } = copyWith(file());

    copy();
    // The second copy starts once the first is encoding (and its import has settled).
    await vi.waitFor(() => expect(shareLinkFor).toHaveBeenCalledOnce());
    copy();
    await vi.waitFor(() => expect(showNotice).toHaveBeenCalledWith({ kind: "linkCopied" }));
    finishFirst("https://example.test/view/#v1.first");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith("https://example.test/view/#v1.second");
    expect(showNotice).toHaveBeenCalledOnce();
  });

  it("writes a newer copy after an older write still in flight, and reports only the newer", async () => {
    vi.mocked(shareLinkFor)
      .mockResolvedValueOnce("https://example.test/view/#v1.first")
      .mockResolvedValueOnce("https://example.test/view/#v1.second");
    let finishFirstWrite: () => void = () => {};
    vi.mocked(writeText)
      .mockImplementationOnce(() => new Promise<void>((resolve) => (finishFirstWrite = resolve)))
      .mockResolvedValueOnce(undefined);
    const { copy, showNotice } = copyWith(file());

    copy();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    copy();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Two plugin writes in flight could land in either order, so the newer waits.
    expect(writeText).toHaveBeenCalledOnce();
    finishFirstWrite();

    await vi.waitFor(() => expect(showNotice).toHaveBeenCalledWith({ kind: "linkCopied" }));
    expect(vi.mocked(writeText).mock.calls).toEqual([
      ["https://example.test/view/#v1.first"],
      ["https://example.test/view/#v1.second"],
    ]);
    expect(showNotice).toHaveBeenCalledOnce();
  });

  it("skips a queued write that a newer copy overtook while it waited", async () => {
    let finishThirdEncode: (link: string) => void = () => {};
    vi.mocked(shareLinkFor)
      .mockResolvedValueOnce("https://example.test/view/#v1.first")
      .mockResolvedValueOnce("https://example.test/view/#v1.second")
      .mockImplementationOnce(() => new Promise((resolve) => (finishThirdEncode = resolve)));
    let finishFirstWrite: () => void = () => {};
    vi.mocked(writeText)
      .mockImplementationOnce(() => new Promise<void>((resolve) => (finishFirstWrite = resolve)))
      .mockResolvedValue(undefined);
    const { copy, showNotice } = copyWith(file());

    copy();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    copy();
    await new Promise((resolve) => setTimeout(resolve, 0));
    copy();
    finishFirstWrite();
    await new Promise((resolve) => setTimeout(resolve, 0));
    finishThirdEncode("https://example.test/view/#v1.third");

    await vi.waitFor(() => expect(showNotice).toHaveBeenCalledWith({ kind: "linkCopied" }));
    expect(vi.mocked(writeText).mock.calls).toEqual([
      ["https://example.test/view/#v1.first"],
      ["https://example.test/view/#v1.third"],
    ]);
    expect(showNotice).toHaveBeenCalledOnce();
  });

  it("does nothing for a tab the viewer cannot open", () => {
    const { copy, showNotice } = copyWith(file({ path: "/notes/board.canvas" }));

    copy();

    expect(shareLinkFor).not.toHaveBeenCalled();
    expect(showNotice).not.toHaveBeenCalled();
  });
});
