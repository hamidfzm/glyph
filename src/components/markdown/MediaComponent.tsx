import { type ComponentPropsWithoutRef, useCallback } from "react";
import { MarkdownMedia } from "./MarkdownMedia";
import { MarkdownMediaSource } from "./MarkdownMediaSource";

// Binds the document's file path into the `video`, `audio`, and `source`
// components ReactMarkdown renders, so relative media paths resolve against the
// right directory. The workspace root that constrains them is read from context
// by the components themselves, mirroring useImageComponent.

export function useVideoComponent(filePath: string | undefined) {
  return useCallback(
    (props: ComponentPropsWithoutRef<"video">) => (
      <MarkdownMedia {...props} tag="video" filePath={filePath} />
    ),
    [filePath],
  );
}

export function useAudioComponent(filePath: string | undefined) {
  return useCallback(
    (props: ComponentPropsWithoutRef<"audio">) => (
      <MarkdownMedia {...props} tag="audio" filePath={filePath} />
    ),
    [filePath],
  );
}

export function useMediaSourceComponent(filePath: string | undefined) {
  return useCallback(
    (props: ComponentPropsWithoutRef<"source">) => (
      <MarkdownMediaSource {...props} filePath={filePath} />
    ),
    [filePath],
  );
}
