import { type ComponentProps, lazy, Suspense } from "react";

// CodeMirror is heavy (~300 KB). Only load it when a tab actually enters
// edit/split mode — readers who never edit shouldn't pay for it. Suspense
// is wrapped here so callers can use these as drop-in replacements for the
// underlying components without thinking about lazy/Suspense plumbing.
const MarkdownEditorLazy = lazy(() =>
  import("./MarkdownEditor").then((m) => ({ default: m.MarkdownEditor })),
);

const SplitViewLazy = lazy(() => import("./SplitView").then((m) => ({ default: m.SplitView })));

export function MarkdownEditor(props: ComponentProps<typeof MarkdownEditorLazy>) {
  return (
    <Suspense fallback={null}>
      <MarkdownEditorLazy {...props} />
    </Suspense>
  );
}

export function SplitView(props: ComponentProps<typeof SplitViewLazy>) {
  return (
    <Suspense fallback={null}>
      <SplitViewLazy {...props} />
    </Suspense>
  );
}
