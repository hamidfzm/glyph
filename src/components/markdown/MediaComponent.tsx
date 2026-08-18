import { type ComponentPropsWithoutRef, useCallback } from "react";
import type { ExtraProps } from "react-markdown";
import { MarkdownMedia } from "./MarkdownMedia";
import { MarkdownMediaSource } from "./MarkdownMediaSource";

// ReactMarkdown passes the hast node alongside the DOM props; MarkdownMedia
// reads it to tell a resolved <source> child from a refused one.
type MediaProps<T extends "video" | "audio" | "source"> = ComponentPropsWithoutRef<T> & ExtraProps;

// Binds the document's file path into the `video`, `audio`, and `source`
// components ReactMarkdown renders, so relative media paths resolve against the
// right directory. The workspace root that constrains them is read from context
// by the components themselves, mirroring useImageComponent.

export function useVideoComponent(filePath: string | undefined) {
  return useCallback(
    (props: MediaProps<"video">) => <MarkdownMedia {...props} tag="video" filePath={filePath} />,
    [filePath],
  );
}

export function useAudioComponent(filePath: string | undefined) {
  return useCallback(
    (props: MediaProps<"audio">) => <MarkdownMedia {...props} tag="audio" filePath={filePath} />,
    [filePath],
  );
}

export function useMediaSourceComponent(filePath: string | undefined) {
  return useCallback(
    (props: MediaProps<"source">) => <MarkdownMediaSource {...props} filePath={filePath} />,
    [filePath],
  );
}
