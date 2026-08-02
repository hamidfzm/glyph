import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { htmlToMarkdown } from "@/lib/htmlToMarkdown";

/**
 * Insert Markdown when the clipboard carries rich text. Returning false leaves
 * CodeMirror's own paste in charge, which is the fallback for plain-text
 * clipboards, an empty conversion, and malformed HTML that fails to convert.
 */
export function pasteHtmlExtension(isEnabled: () => boolean): Extension {
  return EditorView.domEventHandlers({
    paste(event, view) {
      if (!isEnabled()) return false;
      const html = event.clipboardData?.getData("text/html");
      if (!html) return false;

      let markdown: string;
      try {
        markdown = htmlToMarkdown(html);
      } catch {
        return false;
      }
      if (!markdown) return false;

      view.dispatch(view.state.replaceSelection(markdown), {
        scrollIntoView: true,
        userEvent: "input.paste",
      });
      event.preventDefault();
      return true;
    },
  });
}
